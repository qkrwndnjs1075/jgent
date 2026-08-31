import type { MemoryPolicyDiscardReason } from "./memory-policy.ts"
import type { MemoryPutResult } from "./memory-store.ts"

export type MemoryWriteSummary = {
  readonly extractedCount: number
  readonly approvedCount: number
  readonly discardedCount: number
  readonly insertedCount: number
  readonly duplicateCount: number
  readonly supersededCount: number
  readonly discardReasons: readonly MemoryPolicyDiscardReason[]
}

export function summarizeMemoryWrite(
  extractedCount: number,
  approvedCount: number,
  discardReasons: readonly MemoryPolicyDiscardReason[],
  results: readonly MemoryPutResult[],
): MemoryWriteSummary {
  return Object.freeze({
    extractedCount,
    approvedCount,
    discardedCount: discardReasons.length,
    insertedCount: results.filter(({ type }) => type === "inserted").length,
    duplicateCount: results.filter(({ type }) => type === "duplicate").length,
    supersededCount: results.filter(({ type }) => type === "superseded").length,
    discardReasons: Object.freeze([...discardReasons]),
  })
}
