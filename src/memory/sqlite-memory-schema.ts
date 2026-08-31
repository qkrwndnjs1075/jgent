import type { Database } from "bun:sqlite"
import { z } from "zod"
import {
  MemoryAccessScopeSchema,
  type MemoryRecord,
  MemoryRecordSchema,
  type MemoryScope,
} from "./memory.ts"
import { MemoryStoreInvariantError } from "./memory-store.ts"

export const SQLiteMemoryRecordRowSchema = z
  .object({
    id: z.string(),
    deduplication_key: z.string(),
    fingerprint: z.string(),
    kind: z.string(),
    content: z.string(),
    tags_json: z.string(),
    scope_type: z.string(),
    workspace_id: z.string().nullable(),
    user_id: z.string().nullable(),
    subject_key: z.string().nullable(),
    session_id: z.string(),
    source_revision: z.number().int().nonnegative(),
    source_start: z.number().int().nonnegative(),
    source_end: z.number().int().nonnegative(),
    created_at: z.number().int().nonnegative(),
    active: z.number().int().min(0).max(1),
  })
  .strict()

export type SQLiteMemoryRecordRow = z.infer<typeof SQLiteMemoryRecordRowSchema>

export type SQLiteMemoryStoreOptions = {
  readonly path: string
}

export const SELECT_MEMORY_COLUMNS = `
  SELECT
    m.id AS id,
    m.deduplication_key AS deduplication_key,
    m.fingerprint AS fingerprint,
    m.kind AS kind,
    m.content AS content,
    m.tags_json AS tags_json,
    m.scope_type AS scope_type,
    m.workspace_id AS workspace_id,
    m.user_id AS user_id,
    m.subject_key AS subject_key,
    m.session_id AS session_id,
    m.source_revision AS source_revision,
    m.source_start AS source_start,
    m.source_end AS source_end,
    m.created_at AS created_at,
    m.active AS active
  FROM memories AS m
`

export function initializeMemoryDatabase(db: Database): void {
  const rawVersion = db.query<{ user_version: number }, []>("PRAGMA user_version").get()
  const version = z
    .object({ user_version: z.number().int().nonnegative() })
    .strict()
    .safeParse(rawVersion)
  if (!version.success) {
    throw new MemoryStoreInvariantError("Unable to read Memory schema version")
  }
  if (version.data.user_version === 1) {
    return
  }
  if (version.data.user_version !== 0) {
    throw new MemoryStoreInvariantError(
      `Unsupported Memory schema version ${version.data.user_version}`,
    )
  }
  db.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY NOT NULL,
      deduplication_key TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('project', 'workflow', 'preference', 'lesson')),
      content TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('workspace', 'user', 'workspace_user')),
      workspace_id TEXT,
      user_id TEXT,
      subject_key TEXT,
      session_id TEXT NOT NULL,
      source_revision INTEGER NOT NULL,
      source_start INTEGER NOT NULL,
      source_end INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      active INTEGER NOT NULL CHECK (active IN (0, 1)),
      superseded_by TEXT
    );
    CREATE UNIQUE INDEX memories_active_dedup
      ON memories (kind, scope_type, workspace_id, user_id, deduplication_key)
      WHERE active = 1;
    CREATE UNIQUE INDEX memories_active_preference_subject
      ON memories (scope_type, workspace_id, user_id, subject_key)
      WHERE active = 1 AND kind = 'preference';
    CREATE VIRTUAL TABLE memories_fts USING fts5(id UNINDEXED, content, tags);
    PRAGMA user_version = 1;
  `)
}

export function rowToRecord(row: SQLiteMemoryRecordRow): MemoryRecord {
  const scope = parseScope(row)
  const tags = parseTags(row.tags_json)
  const base = {
    id: row.id,
    deduplicationKey: row.deduplication_key,
    fingerprint: row.fingerprint,
    kind: row.kind,
    content: row.content,
    tags,
    scope,
    source: {
      sessionId: row.session_id,
      sourceRevision: row.source_revision,
      messageRange: { start: row.source_start, end: row.source_end },
    },
    createdAt: row.created_at,
  }
  return MemoryRecordSchema.parse(
    row.kind === "preference" ? { ...base, subjectKey: row.subject_key } : base,
  )
}

export function parseRow(row: SQLiteMemoryRecordRow | null): SQLiteMemoryRecordRow | null {
  return row === null ? null : SQLiteMemoryRecordRowSchema.parse(row)
}

export function parseRows(
  rows: readonly SQLiteMemoryRecordRow[],
): readonly SQLiteMemoryRecordRow[] {
  return rows.map((row) => SQLiteMemoryRecordRowSchema.parse(row))
}

function parseScope(row: SQLiteMemoryRecordRow): MemoryScope {
  const candidate = {
    type: row.scope_type,
    ...(row.workspace_id === null ? {} : { workspaceId: row.workspace_id }),
    ...(row.user_id === null ? {} : { userId: row.user_id }),
  }
  const parsed = MemoryAccessScopeSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new MemoryStoreInvariantError(`Invalid persisted Memory scope for ${row.id}`)
  }
  return parsed.data
}

function parseTags(value: string): readonly string[] {
  let decoded: unknown
  try {
    decoded = JSON.parse(value)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new MemoryStoreInvariantError("Invalid persisted Memory tags")
    }
    throw error
  }
  const parsed = z.array(z.string()).safeParse(decoded)
  if (!parsed.success) {
    throw new MemoryStoreInvariantError("Invalid persisted Memory tags")
  }
  return parsed.data
}
