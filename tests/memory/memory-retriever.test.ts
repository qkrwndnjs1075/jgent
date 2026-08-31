import { expect, test } from "bun:test"
import {
  LexicalMemoryRetriever,
  type MemoryRecord,
  MemoryRecordSchema,
  type MemorySearchQuery,
  type MemoryStore,
  WorkspaceIdSchema,
} from "../../src/index.ts"

const workspaceId = WorkspaceIdSchema.parse("workspace-1")

test("LexicalMemoryRetriever ranks tag matches ahead of content-only matches", async () => {
  // Given
  const tagMatch = recordFor({
    id: "018f72d0-4e88-7e3f-a737-4e8b03724a0e",
    content: "The repository has a reliable workflow.",
    tags: ["transactions"],
    createdAt: 1,
  })
  const contentMatch = recordFor({
    id: "018f72d0-4e88-7e3f-a737-4e8b03724a0f",
    content: "Use transactions when changing the database.",
    tags: ["storage"],
    createdAt: 2,
    deduplicationKey: "b".repeat(64),
    fingerprint: "c".repeat(64),
  })
  const store = new RecordingStore([contentMatch, tagMatch])
  const retriever = new LexicalMemoryRetriever(store)

  // When
  const projection = await retriever.retrieve({
    task: "database transactions",
    accessScope: { type: "workspace", workspaceId },
  })

  // Then
  expect(projection.records.map(({ id }) => id)).toEqual([tagMatch.id, contentMatch.id])
  expect(store.calls).toBe(1)
})

test("LexicalMemoryRetriever applies deterministic ordering and record bounds", async () => {
  // Given
  const records = Array.from({ length: 10 }, (_, index) =>
    recordFor({
      id: `018f72d0-4e88-7e3f-a737-4e8b03724a${(index + 10).toString(16).padStart(2, "0")}`,
      createdAt: index < 2 ? 10 : 1,
      deduplicationKey: index.toString(16).padStart(64, "0"),
      fingerprint: (index + 1).toString(16).padStart(64, "0"),
    }),
  )
  const retriever = new LexicalMemoryRetriever(new RecordingStore(records))

  // When
  const first = await retriever.retrieve({
    task: "transactions",
    accessScope: { type: "workspace", workspaceId },
  })
  const second = await retriever.retrieve({
    task: "transactions",
    accessScope: { type: "workspace", workspaceId },
  })

  // Then
  expect(first.records).toHaveLength(8)
  expect(first.records.map(({ id }) => id)).toEqual(second.records.map(({ id }) => id))
  expect(first.fingerprint).toBe(second.fingerprint)
})

test("LexicalMemoryRetriever renders a bounded data block without provenance", async () => {
  // Given
  const record = recordFor({
    id: "018f72d0-4e88-7e3f-a737-4e8b03724a0e",
    content: "This project uses transactions.",
  })
  const retriever = new LexicalMemoryRetriever(new RecordingStore([record]))

  // When
  const projection = await retriever.retrieve({
    task: "transactions",
    accessScope: { type: "workspace", workspaceId },
  })

  // Then
  expect(projection.renderedDataBlock).toContain("<memory_data>")
  expect(projection.renderedDataBlock).toContain("transactions")
  expect(projection.renderedDataBlock).not.toContain(record.id)
  expect(projection.renderedDataBlock).not.toContain("sourceRevision")
  expect(projection.fingerprint).toHaveLength(64)
})

test("LexicalMemoryRetriever returns empty projection without querying an empty task", async () => {
  // Given
  const store = new RecordingStore([])
  const retriever = new LexicalMemoryRetriever(store)

  // When
  const projection = await retriever.retrieve({
    task: "   ",
    accessScope: { type: "workspace", workspaceId },
  })

  // Then
  expect(projection).toEqual({ records: [] })
  expect(store.calls).toBe(0)
})

test("LexicalMemoryRetriever skips a record that cannot fit without truncating it", async () => {
  // Given
  const large = recordFor({
    id: "018f72d0-4e88-7e3f-a737-4e8b03724a0e",
    content: `transactions ${"x".repeat(500)}`,
  })
  const small = recordFor({
    id: "018f72d0-4e88-7e3f-a737-4e8b03724a0f",
    content: "transactions are explicit",
    deduplicationKey: "b".repeat(64),
    fingerprint: "c".repeat(64),
  })
  const retriever = new LexicalMemoryRetriever(new RecordingStore([large, small]), {
    maxProjectionBytes: 260,
  })

  // When
  const projection = await retriever.retrieve({
    task: "transactions",
    accessScope: { type: "workspace", workspaceId },
  })

  // Then
  expect(projection.records.map(({ id }) => id)).toEqual([small.id])
  expect(projection.renderedDataBlock).not.toContain("x".repeat(100))
})

class RecordingStore implements MemoryStore {
  calls = 0

  constructor(private readonly records: readonly MemoryRecord[]) {}

  async put(): Promise<readonly []> {
    return []
  }

  async search(query: MemorySearchQuery): Promise<readonly MemoryRecord[]> {
    this.calls += 1
    return this.records.filter(
      ({ scope }) =>
        scope.type === "workspace" &&
        query.accessScope.type === "workspace" &&
        scope.workspaceId === query.accessScope.workspaceId,
    )
  }
}

function recordFor(input: {
  readonly id: string
  readonly content?: string
  readonly tags?: readonly string[]
  readonly createdAt?: number
  readonly deduplicationKey?: string
  readonly fingerprint?: string
}): MemoryRecord {
  return MemoryRecordSchema.parse({
    id: input.id,
    deduplicationKey: input.deduplicationKey ?? "a".repeat(64),
    fingerprint: input.fingerprint ?? "f".repeat(64),
    kind: "project",
    content: input.content ?? "This project uses transactions.",
    tags: input.tags ?? ["transactions"],
    scope: { type: "workspace", workspaceId },
    source: {
      sessionId: "018f72d0-4e88-7e3f-a737-4e8b03724a0e",
      sourceRevision: 2,
      messageRange: { start: 0, end: 2 },
    },
    createdAt: input.createdAt ?? 1,
  })
}
