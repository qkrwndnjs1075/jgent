import { z } from "zod"
import {
  MAX_MEMORY_SEARCH_RESULTS,
  type MemoryAccessScope,
  MemoryAccessScopeSchema,
  type MemoryId,
  MemoryIdSchema,
  type MemoryRecord,
  MemoryRecordSchema,
  type MemoryScope,
} from "./memory.ts"

export const MemorySearchQuerySchema = z
  .object({
    accessScope: MemoryAccessScopeSchema,
    terms: z.array(z.string().trim().min(1)).min(1),
    limit: z.number().int().positive().max(MAX_MEMORY_SEARCH_RESULTS),
  })
  .strict()

export const MemoryPutResultSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("inserted"), record: MemoryRecordSchema }).strict(),
  z.object({ type: z.literal("duplicate"), record: MemoryRecordSchema }).strict(),
  z
    .object({
      type: z.literal("superseded"),
      record: MemoryRecordSchema,
      supersededMemoryId: MemoryIdSchema,
    })
    .strict(),
])

export type MemorySearchQuery = {
  readonly accessScope: MemoryAccessScope
  readonly terms: readonly string[]
  readonly limit: number
}

export type MemoryPutResult =
  | { readonly type: "inserted"; readonly record: MemoryRecord }
  | { readonly type: "duplicate"; readonly record: MemoryRecord }
  | {
      readonly type: "superseded"
      readonly record: MemoryRecord
      readonly supersededMemoryId: MemoryId
    }

export interface MemoryStore {
  put(records: readonly MemoryRecord[]): Promise<readonly MemoryPutResult[]>

  search(query: MemorySearchQuery): Promise<readonly MemoryRecord[]>
}

export class InMemoryMemoryStore implements MemoryStore {
  #records = new Map<MemoryId, StoredRecord>()

  async put(records: readonly MemoryRecord[]): Promise<readonly MemoryPutResult[]> {
    const next = cloneState(this.#records)
    const results: MemoryPutResult[] = []
    for (const input of records) {
      const record = MemoryRecordSchema.parse(input)
      const existing = next.get(record.id)
      if (existing !== undefined && !sameRecord(existing.record, record)) {
        throw new MemoryStoreInvariantError(`Memory ID ${record.id} is already assigned`)
      }

      const duplicate = findActiveDuplicate(next, record)
      if (duplicate !== undefined) {
        results.push({ type: "duplicate", record: freezeRecord(duplicate.record) })
        continue
      }

      const superseded = findActivePreference(next, record)
      if (superseded !== undefined) {
        next.set(superseded.record.id, { record: superseded.record, active: false })
      }
      next.set(record.id, { record: freezeRecord(record), active: true })
      results.push(
        superseded === undefined
          ? { type: "inserted", record: freezeRecord(record) }
          : {
              type: "superseded",
              record: freezeRecord(record),
              supersededMemoryId: superseded.record.id,
            },
      )
    }
    this.#records = next
    return Object.freeze(results)
  }

  async search(input: MemorySearchQuery): Promise<readonly MemoryRecord[]> {
    const query = MemorySearchQuerySchema.parse(input)
    const terms = query.terms.map((term) => normalize(term))
    const matches = [...this.#records.values()]
      .filter(({ active }) => active)
      .map(({ record }) => record)
      .filter((record) => visibleTo(record.scope, query.accessScope))
      .filter((record) => matchesTerms(record, terms))
      .sort(compareRecords)
      .slice(0, query.limit)
      .map(freezeRecord)
    return Object.freeze(matches)
  }
}

type StoredRecord = {
  readonly record: MemoryRecord
  readonly active: boolean
}

function cloneState(records: ReadonlyMap<MemoryId, StoredRecord>): Map<MemoryId, StoredRecord> {
  const next = new Map<MemoryId, StoredRecord>()
  for (const [id, value] of records) {
    next.set(id, value)
  }
  return next
}

function findActiveDuplicate(
  records: ReadonlyMap<MemoryId, StoredRecord>,
  record: MemoryRecord,
): StoredRecord | undefined {
  return [...records.values()].find(
    (value) =>
      value.active &&
      value.record.deduplicationKey === record.deduplicationKey &&
      value.record.kind === record.kind &&
      scopeKey(value.record.scope) === scopeKey(record.scope),
  )
}

function findActivePreference(
  records: ReadonlyMap<MemoryId, StoredRecord>,
  record: MemoryRecord,
): StoredRecord | undefined {
  if (record.kind !== "preference") {
    return undefined
  }
  return [...records.values()].find(
    (value) =>
      value.active &&
      value.record.kind === "preference" &&
      value.record.subjectKey === record.subjectKey &&
      scopeKey(value.record.scope) === scopeKey(record.scope),
  )
}

function sameRecord(left: MemoryRecord, right: MemoryRecord): boolean {
  return left.fingerprint === right.fingerprint
}

function matchesTerms(record: MemoryRecord, terms: readonly string[]): boolean {
  const searchable = normalize([record.content, ...record.tags].join(" "))
  return terms.some((term) => searchable.includes(term))
}

function compareRecords(left: MemoryRecord, right: MemoryRecord): number {
  if (left.createdAt !== right.createdAt) {
    return right.createdAt - left.createdAt
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function visibleTo(record: MemoryScope, access: MemoryAccessScope): boolean {
  switch (access.type) {
    case "workspace":
      return record.type === "workspace" && record.workspaceId === access.workspaceId
    case "user":
      return record.type === "user" && record.userId === access.userId
    case "workspace_user":
      return (
        (record.type === "workspace" && record.workspaceId === access.workspaceId) ||
        (record.type === "user" && record.userId === access.userId) ||
        (record.type === "workspace_user" &&
          record.workspaceId === access.workspaceId &&
          record.userId === access.userId)
      )
    default:
      return assertNever(access)
  }
}

function scopeKey(scope: MemoryScope): string {
  switch (scope.type) {
    case "workspace":
      return `workspace:${scope.workspaceId}`
    case "user":
      return `user:${scope.userId}`
    case "workspace_user":
      return `workspace_user:${scope.workspaceId}:${scope.userId}`
    default:
      return assertNever(scope)
  }
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase()
}

function freezeRecord(record: MemoryRecord): MemoryRecord {
  return deepFreeze(structuredClone(record))
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value
  }
  for (const child of Object.values(value)) {
    deepFreeze(child)
  }
  return Object.freeze(value)
}

function assertNever(value: never): never {
  throw new MemoryStoreInvariantError(`Unexpected Memory variant: ${String(value)}`)
}

export class MemoryStoreInvariantError extends Error {
  readonly name = "MemoryStoreInvariantError"
}
