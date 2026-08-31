import { randomUUID } from "node:crypto"
import { AttemptIdSchema, AttemptNumberSchema } from "./contracts.ts"
import {
  isLegalItemTransition,
  isTerminalItemState,
  type MutableItem,
  type MutableModelItem,
  type MutableToolItem,
  snapshotItem,
  snapshotModel,
  snapshotTool,
} from "./item-state.ts"
import type { AttemptRecord, AttemptTerminalState } from "./item-types.ts"
import {
  type AttemptHandle,
  type AttemptId,
  type ItemClaim,
  type ItemId,
  type ItemRecord,
  ItemRegistryError,
  type ItemRegistryErrorCode,
  type ItemRegistryErrorContext,
  type ItemRegistryOptions,
  type ItemState,
  type ModelItemInput,
  type ModelItemRecord,
  type ToolItemInput,
  type ToolItemRecord,
} from "./item-types.ts"

export type {
  AttemptHandle,
  AttemptId,
  AttemptNumber,
  AttemptRecord,
  AttemptState,
  AttemptTerminalState,
  ItemBase,
  ItemClaim,
  ItemId,
  ItemRecord,
  ItemRegistryErrorCode,
  ItemRegistryErrorContext,
  ItemRegistryOptions,
  ItemState,
  ModelItemInput,
  ModelItemRecord,
  ToolItemInput,
  ToolItemRecord,
} from "./item-types.ts"
export {
  ItemRegistryError,
  ItemRegistryError as InvalidItemTransitionError,
  ItemRegistryError as ItemClaimConflictError,
} from "./item-types.ts"

export class ItemRegistry {
  readonly #items = new Map<ItemId, MutableItem>()
  readonly #attemptIds = new Set<AttemptId>()
  readonly #now: () => number
  readonly #itemIdFactory: () => ItemId
  readonly #attemptIdFactory: () => AttemptId

  constructor(options: ItemRegistryOptions = {}) {
    this.#now = options.now ?? Date.now
    this.#itemIdFactory = options.itemIdFactory ?? randomUUID
    this.#attemptIdFactory = options.attemptIdFactory ?? (() => AttemptIdSchema.parse(randomUUID()))
  }

  get nonterminalItemCount(): number {
    return [...this.#items.values()].filter(({ state }) => !isTerminalItemState(state)).length
  }

  get executingAttemptCount(): number {
    return [...this.#items.values()].reduce(
      (count, item) => count + item.attempts.filter(({ state }) => state === "executing").length,
      0,
    )
  }

  get pendingApprovalCount(): number {
    return [...this.#items.values()].filter(({ state }) => state === "awaiting_approval").length
  }

  get items(): readonly ItemRecord[] {
    return [...this.#items.values()].map(snapshotItem)
  }

  registerModel(input: ModelItemInput = {}): ModelItemRecord {
    const item: MutableModelItem = {
      itemId: this.resolveItemId(input.itemId),
      kind: "model",
      state: "created",
      attempts: [],
      ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    }
    this.insert(item)
    return snapshotModel(item)
  }

  registerTool(input: ToolItemInput): ToolItemRecord {
    ensureIdentity(input.toolCallId)
    ensureIdentity(input.toolName)
    const item: MutableToolItem = {
      itemId: this.resolveItemId(input.itemId),
      kind: "tool",
      state: "created",
      attempts: [],
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    }
    this.insert(item)
    return snapshotTool(item)
  }

  get(itemId: ItemId): ItemRecord | undefined {
    const item = this.#items.get(itemId)
    return item === undefined ? undefined : snapshotItem(item)
  }

  claim(itemId: ItemId): ItemClaim {
    const item = this.require(itemId)
    if (
      item.claimedBy !== undefined ||
      isTerminalItemState(item.state) ||
      item.state === "executing"
    ) {
      throw registryError("claim_conflict", { itemId })
    }
    const owner = Symbol("item-claim")
    item.claimedBy = owner
    let released = false
    const ensureOwner = (): void => {
      if (released || this.require(itemId).claimedBy !== owner) {
        throw registryError("claim_released", { itemId })
      }
    }
    return {
      itemId,
      startAttempt: () => {
        ensureOwner()
        return this.startAttemptForOwner(itemId, owner)
      },
      release: () => {
        if (released) return
        released = true
        const current = this.#items.get(itemId)
        if (current?.claimedBy === owner) delete current.claimedBy
      },
    }
  }

  transition(itemId: ItemId, state: ItemState): ItemRecord {
    const item = this.require(itemId)
    if (item.claimedBy !== undefined) throw registryError("claim_conflict", { itemId })
    return this.applyTransition(item, state)
  }

  startAttempt(itemId: ItemId): AttemptHandle {
    const item = this.require(itemId)
    if (item.claimedBy !== undefined) throw registryError("claim_conflict", { itemId })
    if (item.state !== "created" && item.state !== "awaiting_approval") {
      throw registryError("invalid_transition", { itemId, from: item.state, to: "executing" })
    }
    const owner = Symbol("effect")
    item.claimedBy = owner
    return this.startAttemptForOwner(itemId, owner)
  }

  finishAttempt(itemId: ItemId, attemptId: AttemptId, state: AttemptTerminalState): ItemRecord {
    const item = this.require(itemId)
    if (item.state !== "executing") {
      throw registryError("invalid_transition", { itemId, from: item.state, to: state })
    }
    const index = item.attempts.findIndex(({ attemptId: id }) => id === attemptId)
    const attempt = index < 0 ? undefined : item.attempts[index]
    if (attempt === undefined) throw registryError("unknown_attempt", { attemptId })
    if (attempt.state !== "executing") throw registryError("attempt_finished", { attemptId })
    item.attempts[index] = { ...attempt, state, finishedAt: this.#now() }
    item.state = state
    delete item.claimedBy
    return snapshotItem(item)
  }

  private startAttemptForOwner(itemId: ItemId, owner: symbol): AttemptHandle {
    const item = this.require(itemId)
    if (item.claimedBy !== owner) throw registryError("claim_conflict", { itemId })
    if (item.state !== "created" && item.state !== "awaiting_approval") {
      throw registryError("invalid_transition", { itemId, from: item.state, to: "executing" })
    }
    const attemptId = this.nextAttemptId()
    const attempt: AttemptRecord = {
      attemptId,
      attemptNumber: AttemptNumberSchema.parse(item.attempts.length + 1),
      state: "executing",
      startedAt: this.#now(),
    }
    item.attempts.push(attempt)
    item.state = "executing"
    return {
      record: { ...attempt },
      complete: () => this.finishAttempt(itemId, attemptId, "completed"),
      fail: () => this.finishAttempt(itemId, attemptId, "failed"),
      cancel: () => this.finishAttempt(itemId, attemptId, "cancelled"),
    }
  }

  private applyTransition(item: MutableItem, state: ItemState): ItemRecord {
    if (!isLegalItemTransition(item.state, state)) {
      throw registryError("invalid_transition", {
        itemId: item.itemId,
        from: item.state,
        to: state,
      })
    }
    item.state = state
    if (isTerminalItemState(state)) delete item.claimedBy
    return snapshotItem(item)
  }

  private resolveItemId(itemId: ItemId | undefined): ItemId {
    const resolved = itemId ?? this.#itemIdFactory()
    ensureIdentity(resolved)
    return resolved
  }

  private insert(item: MutableItem): void {
    if (this.#items.has(item.itemId)) throw registryError("duplicate_item", { itemId: item.itemId })
    this.#items.set(item.itemId, item)
  }

  private require(itemId: ItemId): MutableItem {
    const item = this.#items.get(itemId)
    if (item === undefined) throw registryError("unknown_item", { itemId })
    return item
  }

  private nextAttemptId(): AttemptId {
    const attemptId = AttemptIdSchema.parse(this.#attemptIdFactory())
    ensureIdentity(attemptId)
    if (this.#attemptIds.has(attemptId)) throw registryError("duplicate_item", { attemptId })
    this.#attemptIds.add(attemptId)
    return attemptId
  }
}

function ensureIdentity(identity: string): void {
  if (identity.length === 0) throw registryError("invalid_identity", { identity })
}

function registryError(
  code: ItemRegistryErrorCode,
  context: ItemRegistryErrorContext,
): ItemRegistryError {
  return new ItemRegistryError(code, context)
}
