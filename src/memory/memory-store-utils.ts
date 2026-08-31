import type { MemoryRecord, MemoryScope } from "./memory.ts"
import type { MemoryPutResult } from "./memory-store.ts"

export function scopeWorkspaceId(scope: MemoryScope): string | null {
  return scope.type === "user" ? null : scope.workspaceId
}

export function scopeUserId(scope: MemoryScope): string | null {
  return scope.type === "workspace" ? null : scope.userId
}

export function freezeRecord(record: MemoryRecord): MemoryRecord {
  return deepFreeze(structuredClone(record))
}

export function freezeResults(results: readonly MemoryPutResult[]): readonly MemoryPutResult[] {
  return deepFreeze(structuredClone(results))
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
