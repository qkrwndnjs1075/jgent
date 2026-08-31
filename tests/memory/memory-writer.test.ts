import { expect, test } from "bun:test"
import {
  type CompletedRunMemoryInput,
  DefaultMemoryPolicy,
  DefaultMemoryWriter,
  ExplicitMemoryCandidateExtractor,
  InMemoryMemoryStore,
  type MemoryCandidate,
  MemoryCandidateSchema,
  MemoryIdSchema,
  type MemoryPutResult,
  type MemoryRecord,
  type MemoryStore,
  MemoryWriterInvariantError,
  UserIdSchema,
  WorkspaceIdSchema,
} from "../../src/index.ts"
import { SessionIdSchema, SessionRevisionSchema } from "../../src/session/index.ts"

const sessionId = SessionIdSchema.parse("018f72d0-4e88-7e3f-a737-4e8b03724a0e")
const workspaceId = WorkspaceIdSchema.parse("workspace-1")
const userId = UserIdSchema.parse("user-1")

test("DefaultMemoryWriter writes approved candidates with canonical provenance", async () => {
  // Given
  const store = new RecordingStore()
  const candidate = candidateFor({ sourceRange: { start: 1, end: 2 } })
  const writer = new DefaultMemoryWriter({
    extractor: new ExplicitMemoryCandidateExtractor([candidate]),
    policy: new DefaultMemoryPolicy(),
    store,
    now: () => 42,
    createId: () => MemoryIdSchema.parse("018f72d0-4e88-7e3f-a737-4e8b03724a0e"),
  })

  // When
  const summary = await writer.write(runFor())

  // Then
  expect(summary).toMatchObject({
    extractedCount: 1,
    approvedCount: 1,
    discardedCount: 0,
    insertedCount: 1,
  })
  expect(store.records[0]?.source).toEqual({
    sessionId,
    sourceRevision: SessionRevisionSchema.parse(7),
    messageRange: { start: 11, end: 12 },
  })
  expect(store.records[0]?.createdAt).toBe(42)
})

test("DefaultMemoryWriter never persists rejected candidates", async () => {
  // Given
  const store = new RecordingStore()
  const writer = new DefaultMemoryWriter({
    extractor: new ExplicitMemoryCandidateExtractor([
      candidateFor({ durable: false }),
      candidateFor({ sensitivity: "sensitive" }),
      candidateFor({ sourceRange: { start: 1, end: 2 } }),
    ]),
    policy: new DefaultMemoryPolicy(),
    store,
    now: () => 42,
    createId: () => MemoryIdSchema.parse("018f72d0-4e88-7e3f-a737-4e8b03724a0e"),
  })

  // When
  const summary = await writer.write(
    runFor({
      messages: [
        { role: "user", content: "request" },
        { role: "tool", result: { toolCallId: "call-1", success: true, output: "output" } },
      ],
    }),
  )

  // Then
  expect(summary.approvedCount).toBe(0)
  expect(summary.discardedCount).toBe(3)
  expect(summary.discardReasons).toEqual(["not_durable", "sensitive", "tool_source"])
  expect(store.putCalls).toBe(0)
})

test("DefaultMemoryWriter parses unknown extractor output and reports it without persisting", async () => {
  // Given
  const store = new RecordingStore()
  const writer = new DefaultMemoryWriter({
    extractor: new ExplicitMemoryCandidateExtractor([{}]),
    policy: new DefaultMemoryPolicy(),
    store,
    now: () => 42,
    createId: () => MemoryIdSchema.parse("018f72d0-4e88-7e3f-a737-4e8b03724a0e"),
  })

  // When
  const summary = await writer.write(runFor())

  // Then
  expect(summary).toMatchObject({
    extractedCount: 1,
    approvedCount: 0,
    discardedCount: 1,
    discardReasons: ["invalid_candidate"],
  })
  expect(store.putCalls).toBe(0)
})

test("DefaultMemoryWriter reports atomic Store duplicate and supersession outcomes", async () => {
  // Given
  const store = new InMemoryMemoryStore()
  const first = candidateFor({ kind: "preference", targetScope: "user", subjectKey: "editor" })
  const firstWriter = createWriter(store, [first])
  await firstWriter.write(runFor({ accessScope: { type: "user", userId } }))
  const second = candidateFor({
    kind: "preference",
    targetScope: "user",
    subjectKey: "editor",
    content: "Use Emacs for editing.",
  })
  const secondWriter = createWriter(store, [second], "018f72d0-4e88-7e3f-a737-4e8b03724a0f")

  // When
  const summary = await secondWriter.write(runFor({ accessScope: { type: "user", userId } }))

  // Then
  expect(summary.supersededCount).toBe(1)
  expect(
    await store.search({
      accessScope: { type: "user", userId },
      terms: ["Emacs"],
      limit: 8,
    }),
  ).toHaveLength(1)
})

test("DefaultMemoryWriter rejects a completed Run range that does not match its delta", async () => {
  // Given
  const extractor = new ExplicitMemoryCandidateExtractor([candidateFor({})])
  const store = new RecordingStore()
  const writer = new DefaultMemoryWriter({
    extractor,
    policy: new DefaultMemoryPolicy(),
    store,
    now: () => 42,
    createId: () => MemoryIdSchema.parse("018f72d0-4e88-7e3f-a737-4e8b03724a0e"),
  })

  // When
  const invalidRun = runFor()
  const write = writer.write({
    ...invalidRun,
    messageRange: { start: 10, end: 13 },
  })

  // Then
  await expect(write).rejects.toBeInstanceOf(MemoryWriterInvariantError)
  expect(store.putCalls).toBe(0)
})

function createWriter(
  store: MemoryStore,
  candidates: readonly unknown[],
  id = "018f72d0-4e88-7e3f-a737-4e8b03724a00",
): DefaultMemoryWriter {
  return new DefaultMemoryWriter({
    extractor: new ExplicitMemoryCandidateExtractor(candidates),
    policy: new DefaultMemoryPolicy(),
    store,
    now: () => 42,
    createId: () => MemoryIdSchema.parse(id),
  })
}

class RecordingStore implements MemoryStore {
  readonly records: MemoryRecord[] = []
  putCalls = 0

  async put(records: readonly MemoryRecord[]): Promise<readonly MemoryPutResult[]> {
    this.putCalls += 1
    this.records.push(...records)
    return records.map((record) => ({ type: "inserted" as const, record }))
  }

  async search(): Promise<readonly MemoryRecord[]> {
    return this.records
  }
}

function runFor(
  input: {
    readonly accessScope?: CompletedRunMemoryInput["accessScope"]
    readonly messages?: CompletedRunMemoryInput["messages"]
  } = {},
): CompletedRunMemoryInput {
  const messages = input.messages ?? [
    { role: "user", content: "request" },
    { role: "assistant", content: "response" },
  ]
  return {
    sessionId,
    sourceRevision: SessionRevisionSchema.parse(7),
    messageRange: { start: 10, end: 10 + messages.length },
    task: "remember the project pattern",
    accessScope: input.accessScope ?? { type: "workspace", workspaceId },
    messages,
    signal: new AbortController().signal,
  }
}

function candidateFor(input: {
  readonly kind?: "project" | "workflow" | "preference" | "lesson"
  readonly targetScope?: "workspace" | "user" | "workspace_user"
  readonly content?: string
  readonly durable?: boolean
  readonly generalizable?: boolean
  readonly sensitivity?: "non_sensitive" | "sensitive" | "unknown"
  readonly rawHistory?: boolean
  readonly sourceRange?: { readonly start: number; readonly end: number }
  readonly subjectKey?: string
}): MemoryCandidate {
  return MemoryCandidateSchema.parse({
    kind: input.kind ?? "project",
    targetScope: input.targetScope ?? "workspace",
    content: input.content ?? "This project uses focused integration tests.",
    tags: ["testing"],
    durable: input.durable ?? true,
    generalizable: input.generalizable ?? true,
    sensitivity: input.sensitivity ?? "non_sensitive",
    rawHistory: input.rawHistory ?? false,
    sourceRange: input.sourceRange ?? { start: 0, end: 1 },
    ...(input.subjectKey === undefined ? {} : { subjectKey: input.subjectKey }),
  })
}
