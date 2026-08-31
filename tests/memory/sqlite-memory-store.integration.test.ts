import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type MemoryRecord,
  MemoryRecordSchema,
  type MemorySearchQuery,
  MemoryStoreInvariantError,
  SQLiteMemoryStore,
  UserIdSchema,
  WorkspaceIdSchema,
} from "../../src/index.ts"

const sessionId = "018f72d0-4e88-7e3f-a737-4e8b03724a0e"
const workspace1 = WorkspaceIdSchema.parse("workspace-1")
const workspace2 = WorkspaceIdSchema.parse("workspace-2")
const user1 = UserIdSchema.parse("user-1")

test("SQLiteMemoryStore survives a close and a new Store instance", async () => {
  // Given
  const directory = await mkdtemp(join(tmpdir(), "jgent-memory-"))
  const path = join(directory, "memory.sqlite")
  const record = recordFor({ id: "018f72d0-4e88-7e3f-a737-4e8b03724a0e" })

  // When
  const first = new SQLiteMemoryStore({ path })
  await first.put([record])
  first.close()
  const second = new SQLiteMemoryStore({ path })
  const restored = await second.search(queryFor("transactions"))
  second.close()
  await rm(directory, { recursive: true, force: true })

  // Then
  expect(restored).toEqual([record])
})

test("SQLiteMemoryStore deduplicates exact writes across two connections", async () => {
  // Given
  const directory = await mkdtemp(join(tmpdir(), "jgent-memory-"))
  const path = join(directory, "memory.sqlite")
  const record = recordFor({ id: "018f72d0-4e88-7e3f-a737-4e8b03724a0e" })
  const first = new SQLiteMemoryStore({ path })
  const second = new SQLiteMemoryStore({ path })

  // When
  const results = await Promise.all([first.put([record]), second.put([record])])
  first.close()
  second.close()
  await rm(directory, { recursive: true, force: true })

  // Then
  expect(
    results
      .flat()
      .map(({ type }) => type)
      .sort(),
  ).toEqual(["duplicate", "inserted"])
})

test("SQLiteMemoryStore supersedes a preference and searches only the active value", async () => {
  // Given
  const directory = await mkdtemp(join(tmpdir(), "jgent-memory-"))
  const path = join(directory, "memory.sqlite")
  const first = new SQLiteMemoryStore({ path })
  const oldPreference = recordFor({
    kind: "preference",
    subjectKey: "editor",
    content: "Use Vim for editing.",
    id: "018f72d0-4e88-7e3f-a737-4e8b03724a0e",
  })
  const newPreference = recordFor({
    kind: "preference",
    subjectKey: "editor",
    content: "Use Emacs for editing.",
    id: "018f72d0-4e88-7e3f-a737-4e8b03724a0f",
    deduplicationKey: "b".repeat(64),
    fingerprint: "c".repeat(64),
  })
  await first.put([oldPreference])

  // When
  const [result] = await first.put([newPreference])
  const oldResults = await first.search(queryFor("Vim"))
  const newResults = await first.search(queryFor("Emacs"))
  first.close()
  await rm(directory, { recursive: true, force: true })

  // Then
  expect(result).toMatchObject({
    type: "superseded",
    supersededMemoryId: oldPreference.id,
  })
  expect(oldResults).toEqual([])
  expect(newResults).toEqual([newPreference])
})

test("SQLiteMemoryStore rolls back a batch when a Memory ID conflicts", async () => {
  // Given
  const directory = await mkdtemp(join(tmpdir(), "jgent-memory-"))
  const path = join(directory, "memory.sqlite")
  const store = new SQLiteMemoryStore({ path })
  const first = recordFor({ id: "018f72d0-4e88-7e3f-a737-4e8b03724a0e" })
  const conflicting = recordFor({
    id: first.id,
    content: "This conflicting record must not commit.",
    deduplicationKey: "b".repeat(64),
    fingerprint: "c".repeat(64),
  })

  // When
  const write = store.put([first, conflicting])

  // Then
  await expect(write).rejects.toBeInstanceOf(MemoryStoreInvariantError)
  expect(await store.search(queryFor("transactions"))).toEqual([])
  store.close()
  await rm(directory, { recursive: true, force: true })
})

test("SQLiteMemoryStore enforces exact workspace and user visibility", async () => {
  // Given
  const directory = await mkdtemp(join(tmpdir(), "jgent-memory-"))
  const path = join(directory, "memory.sqlite")
  const store = new SQLiteMemoryStore({ path })
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
  const user = await store.search({
    ...queryFor("transactions"),
    accessScope: { type: "user", userId: user1 },
  })
  const combined = await store.search({
    ...queryFor("transactions"),
    accessScope: {
      type: "workspace_user",
      workspaceId: workspace1,
      userId: user1,
    },
  })
  store.close()
  await rm(directory, { recursive: true, force: true })

  // Then
  expect(workspace.map(({ scope }) => scope)).toEqual([
    { type: "workspace", workspaceId: workspace1 },
  ])
  expect(user.map(({ scope }) => scope)).toEqual([{ type: "user", userId: user1 }])
  expect(combined.map(({ scope }) => scope)).toHaveLength(2)
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
