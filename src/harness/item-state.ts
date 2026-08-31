import type {
  AttemptRecord,
  ItemBase,
  ItemId,
  ItemRecord,
  ItemState,
  ModelItemRecord,
  ToolItemRecord,
} from "./item-types.ts"

export type MutableBase = {
  itemId: ItemId
  state: ItemState
  attempts: AttemptRecord[]
  turnId?: string
  claimedBy?: symbol
}

export type MutableModelItem = MutableBase & { kind: "model" }
export type MutableToolItem = MutableBase & {
  kind: "tool"
  toolCallId: string
  toolName: string
}
export type MutableItem = MutableModelItem | MutableToolItem
export type SnapshotBase = Omit<ItemBase, "kind">

export function isTerminalItemState(state: ItemState): boolean {
  return state === "completed" || state === "failed" || state === "denied" || state === "cancelled"
}

export function isLegalItemTransition(from: ItemState, to: ItemState): boolean {
  return from === "created"
    ? to === "awaiting_approval" || to === "failed" || to === "denied" || to === "cancelled"
    : from === "awaiting_approval"
      ? to === "created" || to === "failed" || to === "denied" || to === "cancelled"
      : false
}

export function snapshotModel(item: MutableModelItem): ModelItemRecord {
  return Object.freeze({ ...snapshotBase(item), kind: "model" })
}

export function snapshotTool(item: MutableToolItem): ToolItemRecord {
  return Object.freeze({
    ...snapshotBase(item),
    kind: "tool",
    toolCallId: item.toolCallId,
    toolName: item.toolName,
  })
}

export function snapshotItem(item: MutableItem): ItemRecord {
  return item.kind === "model" ? snapshotModel(item) : snapshotTool(item)
}

function snapshotBase(item: MutableBase): SnapshotBase {
  return {
    itemId: item.itemId,
    state: item.state,
    attempts: Object.freeze(item.attempts.map((attempt) => Object.freeze({ ...attempt }))),
    ...(item.turnId === undefined ? {} : { turnId: item.turnId }),
  }
}
