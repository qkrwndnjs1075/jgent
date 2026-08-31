import type { Database } from "bun:sqlite"
import type { MemorySearchQuery } from "./memory-store.ts"
import { MemoryStoreInvariantError } from "./memory-store.ts"
import {
  parseRows,
  SELECT_MEMORY_COLUMNS,
  type SQLiteMemoryRecordRow,
} from "./sqlite-memory-schema.ts"

export function searchMemoryRows(
  db: Database,
  query: MemorySearchQuery,
): readonly SQLiteMemoryRecordRow[] {
  const match = query.terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(" OR ")
  const order = "ORDER BY bm25(memories_fts) ASC, m.created_at DESC, m.id ASC LIMIT ?"
  switch (query.accessScope.type) {
    case "workspace":
      return parseRows(
        db
          .query<SQLiteMemoryRecordRow, [string, string, number]>(
            `${SELECT_MEMORY_COLUMNS}
             JOIN memories_fts ON memories_fts.id = m.id
             WHERE m.active = 1 AND memories_fts MATCH ?1
               AND m.scope_type = 'workspace' AND m.workspace_id = ?2 ${order}`,
          )
          .all(match, query.accessScope.workspaceId, query.limit),
      )
    case "user":
      return parseRows(
        db
          .query<SQLiteMemoryRecordRow, [string, string, number]>(
            `${SELECT_MEMORY_COLUMNS}
             JOIN memories_fts ON memories_fts.id = m.id
             WHERE m.active = 1 AND memories_fts MATCH ?1
               AND m.scope_type = 'user' AND m.user_id = ?2 ${order}`,
          )
          .all(match, query.accessScope.userId, query.limit),
      )
    case "workspace_user":
      return parseRows(
        db
          .query<SQLiteMemoryRecordRow, [string, string, string, string, string, number]>(
            `${SELECT_MEMORY_COLUMNS}
             JOIN memories_fts ON memories_fts.id = m.id
             WHERE m.active = 1 AND memories_fts MATCH ?1
               AND ((m.scope_type = 'workspace' AND m.workspace_id = ?2)
                 OR (m.scope_type = 'user' AND m.user_id = ?3)
                 OR (m.scope_type = 'workspace_user'
                   AND m.workspace_id = ?4 AND m.user_id = ?5)) ${order}`,
          )
          .all(
            match,
            query.accessScope.workspaceId,
            query.accessScope.userId,
            query.accessScope.workspaceId,
            query.accessScope.userId,
            query.limit,
          ),
      )
    default:
      return assertNever(query.accessScope)
  }
}

function assertNever(value: never): never {
  throw new MemoryStoreInvariantError(`Unexpected Memory scope: ${String(value)}`)
}
