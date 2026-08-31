import { Database } from "bun:sqlite"
import { type MemoryId, MemoryIdSchema, type MemoryRecord, MemoryRecordSchema } from "./memory.ts"
import {
  type MemoryPutResult,
  type MemorySearchQuery,
  MemorySearchQuerySchema,
  type MemoryStore,
  MemoryStoreInvariantError,
} from "./memory-store.ts"
import { freezeRecord, freezeResults, scopeUserId, scopeWorkspaceId } from "./memory-store-utils.ts"
import {
  initializeMemoryDatabase,
  parseRow,
  rowToRecord,
  SELECT_MEMORY_COLUMNS,
  type SQLiteMemoryRecordRow,
  type SQLiteMemoryStoreOptions,
} from "./sqlite-memory-schema.ts"
import { searchMemoryRows } from "./sqlite-memory-search.ts"

export type { SQLiteMemoryStoreOptions } from "./sqlite-memory-schema.ts"
export { SQLiteMemoryRecordRowSchema } from "./sqlite-memory-schema.ts"

export class SQLiteMemoryStore implements MemoryStore {
  readonly #db: Database
  readonly #putTransaction: (records: readonly MemoryRecord[]) => readonly MemoryPutResult[]

  constructor(options: SQLiteMemoryStoreOptions) {
    this.#db = new Database(options.path, { create: true, readwrite: true, strict: true })
    this.#db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")
    initializeMemoryDatabase(this.#db)
    this.#putTransaction = this.#db.transaction((records: readonly MemoryRecord[]) => {
      return this.putInTransaction(records)
    }).immediate
  }

  close(): void {
    this.#db.close()
  }

  async put(records: readonly MemoryRecord[]): Promise<readonly MemoryPutResult[]> {
    return freezeResults(this.#putTransaction(records))
  }

  async search(input: MemorySearchQuery): Promise<readonly MemoryRecord[]> {
    const query = MemorySearchQuerySchema.parse(input)
    const rows = searchMemoryRows(this.#db, query)
    return Object.freeze(rows.map((row) => freezeRecord(rowToRecord(row))))
  }

  private putInTransaction(records: readonly MemoryRecord[]): readonly MemoryPutResult[] {
    const parsedRecords = records.map((record) => MemoryRecordSchema.parse(record))
    const results: MemoryPutResult[] = []
    for (const record of parsedRecords) {
      const existingRow = findById(this.#db, record.id)
      if (existingRow !== null) {
        const existing = rowToRecord(existingRow)
        if (existing.fingerprint !== record.fingerprint || existingRow.active === 0) {
          throw new MemoryStoreInvariantError(`Memory ID ${record.id} is already assigned`)
        }
      }

      const duplicateRow = findActiveDuplicate(this.#db, record)
      if (duplicateRow !== null) {
        results.push({ type: "duplicate", record: freezeRecord(rowToRecord(duplicateRow)) })
        continue
      }

      const supersededRow = findActivePreference(this.#db, record)
      if (supersededRow !== null) {
        deactivate(this.#db, supersededRow.id, record.id)
      }
      insertCanonical(this.#db, record)
      insertSearchRow(this.#db, record)
      results.push(
        supersededRow === null
          ? { type: "inserted", record: freezeRecord(record) }
          : {
              type: "superseded",
              record: freezeRecord(record),
              supersededMemoryId: MemoryIdSchema.parse(supersededRow.id),
            },
      )
    }
    return Object.freeze(results)
  }
}

function findById(db: Database, id: MemoryId): SQLiteMemoryRecordRow | null {
  const row = db
    .query<SQLiteMemoryRecordRow, [string]>(`${SELECT_MEMORY_COLUMNS} WHERE m.id = ?1`)
    .get(id)
  return parseRow(row)
}

function findActiveDuplicate(db: Database, record: MemoryRecord): SQLiteMemoryRecordRow | null {
  return parseRow(
    db
      .query<SQLiteMemoryRecordRow, [string, string, string | null, string | null, string]>(
        `${SELECT_MEMORY_COLUMNS}
         WHERE m.active = 1
           AND m.kind = ?1
           AND m.scope_type = ?2
           AND m.workspace_id IS ?3
           AND m.user_id IS ?4
           AND m.deduplication_key = ?5`,
      )
      .get(
        record.kind,
        record.scope.type,
        scopeWorkspaceId(record.scope),
        scopeUserId(record.scope),
        record.deduplicationKey,
      ),
  )
}

function findActivePreference(db: Database, record: MemoryRecord): SQLiteMemoryRecordRow | null {
  if (record.kind !== "preference") {
    return null
  }
  return parseRow(
    db
      .query<SQLiteMemoryRecordRow, [string, string | null, string | null, string]>(
        `${SELECT_MEMORY_COLUMNS}
         WHERE m.active = 1
           AND m.kind = 'preference'
           AND m.scope_type = ?1
           AND m.workspace_id IS ?2
           AND m.user_id IS ?3
           AND m.subject_key = ?4`,
      )
      .get(
        record.scope.type,
        scopeWorkspaceId(record.scope),
        scopeUserId(record.scope),
        record.subjectKey,
      ),
  )
}

function deactivate(db: Database, id: string, supersededBy: MemoryId): void {
  db.prepare<never, [string, string]>(
    "UPDATE memories SET active = 0, superseded_by = ?2 WHERE id = ?1",
  ).run(id, supersededBy)
}

function insertCanonical(db: Database, record: MemoryRecord): void {
  db.prepare<
    never,
    [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string | null,
      string | null,
      string | null,
      string,
      number,
      number,
      number,
      number,
    ]
  >(
    `INSERT INTO memories
      (id, deduplication_key, fingerprint, kind, content, tags_json, scope_type,
       workspace_id, user_id, subject_key, session_id, source_revision, source_start,
       source_end, created_at, active)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 1)`,
  ).run(
    record.id,
    record.deduplicationKey,
    record.fingerprint,
    record.kind,
    record.content,
    JSON.stringify(record.tags),
    record.scope.type,
    scopeWorkspaceId(record.scope),
    scopeUserId(record.scope),
    record.kind === "preference" ? record.subjectKey : null,
    record.source.sessionId,
    record.source.sourceRevision,
    record.source.messageRange.start,
    record.source.messageRange.end,
    record.createdAt,
  )
}

function insertSearchRow(db: Database, record: MemoryRecord): void {
  db.prepare<never, [string, string, string]>(
    "INSERT INTO memories_fts (id, content, tags) VALUES (?1, ?2, ?3)",
  ).run(record.id, record.content, record.tags.join(" "))
}
