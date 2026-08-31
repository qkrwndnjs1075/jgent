import type { AttemptId as BrandedAttemptId } from "./contracts.ts"

export type ItemId = string
export type AttemptId = BrandedAttemptId
export type AttemptNumber = number
export type ItemState =
  | "created"
  | "awaiting_approval"
  | "executing"
  | "completed"
  | "failed"
  | "denied"
  | "cancelled"
export type AttemptState = "executing" | "completed" | "failed" | "cancelled"
export type AttemptTerminalState = Exclude<AttemptState, "executing">

export type AttemptRecord = {
  readonly attemptId: AttemptId
  readonly attemptNumber: AttemptNumber
  readonly state: AttemptState
  readonly startedAt: number
  readonly finishedAt?: number
}

export type ItemBase = {
  readonly itemId: ItemId
  readonly state: ItemState
  readonly attempts: readonly AttemptRecord[]
  readonly turnId?: string
}

export type ModelItemRecord = ItemBase & { readonly kind: "model" }
export type ToolItemRecord = ItemBase & {
  readonly kind: "tool"
  readonly toolCallId: string
  readonly toolName: string
}
export type ItemRecord = ModelItemRecord | ToolItemRecord

export type ModelItemInput = { readonly itemId?: ItemId; readonly turnId?: string }
export type ToolItemInput = {
  readonly itemId?: ItemId
  readonly turnId?: string
  readonly toolCallId: string
  readonly toolName: string
}
export type ItemRegistryOptions = {
  readonly now?: () => number
  readonly itemIdFactory?: () => ItemId
  readonly attemptIdFactory?: () => AttemptId
}

export type AttemptHandle = {
  readonly record: AttemptRecord
  readonly complete: () => ItemRecord
  readonly fail: () => ItemRecord
  readonly cancel: () => ItemRecord
}
export type ItemClaim = {
  readonly itemId: ItemId
  readonly startAttempt: () => AttemptHandle
  readonly release: () => void
}

export type ItemRegistryErrorCode =
  | "unknown_item"
  | "duplicate_item"
  | "invalid_transition"
  | "claim_conflict"
  | "claim_released"
  | "unknown_attempt"
  | "attempt_finished"
  | "invalid_identity"
export type ItemRegistryErrorContext = {
  readonly itemId?: ItemId
  readonly attemptId?: AttemptId
  readonly from?: ItemState
  readonly to?: ItemState
  readonly identity?: string
}

export class ItemRegistryError extends Error {
  readonly name = "ItemRegistryError"

  constructor(
    readonly code: ItemRegistryErrorCode,
    readonly context: ItemRegistryErrorContext = {},
  ) {
    super(`${code}: ${context.itemId ?? context.attemptId ?? context.identity ?? ""}`)
  }
}

export {
  ItemRegistryError as InvalidItemTransitionError,
  ItemRegistryError as ItemClaimConflictError,
}
