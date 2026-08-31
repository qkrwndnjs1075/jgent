import { expect, test } from "bun:test"
import {
  InMemoryMemoryStore,
  type MemoryRecord,
  MemoryRecordSchema,
  type MemorySearchQuery,
  type MemoryStore,
  UserIdSchema,
  WorkspaceIdSchema,
} from "../../src/index.ts"

const sessionId = "018f72d0-4e88-7e3f-a737-4e8b03724a0e"
const workspace1 = WorkspaceIdSchema.parse("workspace-1")
const workspace2 = WorkspaceIdSchema.parse("workspace-2")
const user1 = UserIdSchema.parse("user-1")

test("InMemoryMemoryStore collapses concurrent exact writes atomically", async () => {
  // Given
  const store = new InMemoryMemoryStore()
  const record = recordFor({ id: "018f72d0-4e88-7e3f-a737-4e8b03724a0e" })

  // When
  const results = await Promise.all(Array.from({ length: 16 }, () => store.put([record])))
  const flattened = results.flat()

  // Then
  expect(flattened.filter(({ type }) => type === "inserted")).toHaveLength(1)
  expect(flattened.filter(({ type }) => type === "duplicate")).toHaveLength(15)
  expect(await store.search(queryFor("transactions"))).toHaveLength(1)
})

test("InMemoryMemoryStore supersedes an active preference by subject", async () => {
  // Given
  const store = new InMemoryMemoryStore()
  const first = recordFor({
    kind: "preference",
    subjectKey: "editor",
    content: "Use Vim for editing.",
    id: "018f72d0-4e88-7e3f-a737-4e8b03724a0e",
  })
  const second = recordFor({
    kind: "preference",
    subjectKey: "editor",
    content: "Use Emacs for editing.",
    id: "018f72d0-4e88-7e3f-a737-4e8b03724a0f",
    deduplicationKey: "b".repeat(64),
    fingerprint: "c".repeat(64),
  })
  await store.put([first])

  // When
  const [result] = await store.put([second])

  // Then
  expect(result).toMatchObject({
    type: "superseded",
    record: second,
    supersededMemoryId: first.id,
  })
  expect(await store.search(queryFor("Vim"))).toEqual([])
  expect((await store.search(queryFor("Emacs"))).map(({ id }) => id)).toEqual([second.id])
})

test("InMemoryMemoryStore isolates workspace and user scopes", async () => {
  // Given
  const store = new InMemoryMemoryStore()
  await store.put([
    recordFor({ id: "018f72d0-4e88-7e3f-a737-4e8b03724a0e" }),
    recordFor({
      id: "018f72d0-4e88-7e3f-a737-4e8b03724a0f",
      scope: { type: "workspace", workspaceId: workspace2 },
      deduplicationKey: "b".repeat(64),
      fingerprint: "c".repeat(64),
    }),
    recordFor({
      id: "018f72d0-4e88-7e3f-a737-4e8b03724a10",
      scope: { type: "user", userId: user1 },
      deduplicationKey: "d".repeat(64),
      fingerprint: "e".repeat(64),
    }),
  ])

  // When
  const workspace = await store.search(queryFor("transactions"))
  const otherWorkspace = await store.search({
    ...queryFor("transactions"),
    accessScope: { type: "workspace", workspaceId: workspace2 },
  })
  const user = await store.search({
    ...queryFor("transactions"),
    accessScope: { type: "user", userId: user1 },
  })

  // Then
  expect(workspace.map(({ scope }) => scope)).toEqual([
    { type: "workspace", workspaceId: workspace1 },
  ])
  expect(otherWorkspace.map(({ scope }) => scope)).toEqual([
    { type: "workspace", workspaceId: workspace2 },
  ])
  expect(user.map(({ scope }) => scope)).toEqual([{ type: "user", userId: user1 }])
})

test("InMemoryMemoryStore returns frozen defensive records", async () => {
  // Given
  const store = new InMemoryMemoryStore()
  const record = recordFor({ id: "018f72d0-4e88-7e3f-a737-4e8b03724a0e" })
  await store.put([record])

  // When
  const [result] = await store.search(queryFor("transactions"))

  // Then
  expect(result).toBeDefined()
  expect(Object.isFrozen(result)).toBe(true)
  expect(Object.isFrozen(result?.scope)).toBe(true)
  expect(Object.isFrozen(result?.tags)).toBe(true)
})

test("InMemoryMemoryStore returns an empty result for an empty query store", async () => {
  // Given
  const store: MemoryStore = new InMemoryMemoryStore()

  // When
  const records = await store.search(queryFor("missing"))

  // Then
  expect(records).toEqual([])
})

function queryFor(term: string): MemorySearchQuery {
  return {
    accessScope: { type: "workspace", workspaceId: workspace1 },
    terms: [term],
    limit: 8,
  }
}

function recordFor(input: {
  readonly id: string
  readonly kind?: "project" | "workflow" | "preference" | "lesson"
  readonly content?: string
  readonly scope?: MemoryRecord["scope"]
  readonly subjectKey?: string
  readonly deduplicationKey?: string
  readonly fingerprint?: string
}): MemoryRecord {
  return MemoryRecordSchema.parse({
    id: input.id,
    deduplicationKey: input.deduplicationKey ?? "a".repeat(64),
    fingerprint: input.fingerprint ?? "f".repeat(64),
    kind: input.kind ?? "project",
    content: input.content ?? "This project uses transactions.",
    tags: ["transactions"],
    scope: input.scope ?? { type: "workspace", workspaceId: workspace1 },
    ...(input.subjectKey === undefined ? {} : { subjectKey: input.subjectKey }),
    source: {
      sessionId,
      sourceRevision: 2,
      messageRange: { start: 0, end: 2 },
    },
    createdAt: 1,
  })
}
