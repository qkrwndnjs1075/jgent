import type {
  ApprovalId,
  ApprovalStatus,
  AttemptId,
  AttemptNumber,
  EffectDigest,
  ExecutionBudgetResource,
  ExecutionFailure,
  ItemId,
  RunId,
  TurnId,
} from "./contracts.ts"

export type HarnessEventType =
  | "run.started"
  | "run.completed"
  | "run.blocked"
  | "run.cancelled"
  | "run.failed"
  | "turn.started"
  | "turn.completed"
  | "turn.failed"
  | "turn.cancelled"
  | "model.started"
  | "model.completed"
  | "model.failed"
  | "model.cancelled"
  | "tool.requested"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "tool.cancelled"
  | "tool.denied"
  | "approval.requested"
  | "approval.resolved"
  | "budget.exceeded"

type EventBase = {
  readonly runId: RunId
  readonly sequence: number
  readonly occurredAt: number
}

type FailureFields = {
  readonly reason: string
  readonly displayReason?: string
  readonly failure: ExecutionFailure
}

type CancellationFields = {
  readonly reason?: string
  readonly displayReason?: string
  readonly failure?: ExecutionFailure
}

export type RunEvent =
  | (EventBase & { readonly type: "run.started" })
  | (EventBase & { readonly type: "run.completed" })
  | (EventBase & {
      readonly type: "run.blocked"
      readonly reason: string
      readonly failure?: ExecutionFailure
    })
  | (EventBase & { readonly type: "run.cancelled" } & CancellationFields)
  | (EventBase & { readonly type: "run.failed" } & FailureFields)

export type TurnEvent =
  | (EventBase & { readonly type: "turn.started"; readonly turnId: TurnId })
  | (EventBase & { readonly type: "turn.completed"; readonly turnId: TurnId })
  | (EventBase & { readonly type: "turn.failed"; readonly turnId: TurnId } & FailureFields)
  | (EventBase & { readonly type: "turn.cancelled"; readonly turnId: TurnId } & CancellationFields)

type ModelCorrelation = {
  readonly turnId: TurnId
  readonly itemId: ItemId
  readonly attemptId: AttemptId
  readonly attempt: AttemptNumber
}

export type ModelEvent =
  | (EventBase & { readonly type: "model.started" } & ModelCorrelation)
  | (EventBase & { readonly type: "model.completed" } & ModelCorrelation)
  | (EventBase & { readonly type: "model.failed" } & ModelCorrelation & FailureFields)
  | (EventBase & { readonly type: "model.cancelled" } & ModelCorrelation & CancellationFields)

type ToolCorrelation = {
  readonly turnId: TurnId
  readonly itemId: ItemId
  readonly toolCallId: string
  readonly toolName: string
}

type ToolAttemptCorrelation = ToolCorrelation & {
  readonly attemptId: AttemptId
  readonly attempt: AttemptNumber
}

export type ToolEvent =
  | (EventBase & { readonly type: "tool.requested"; readonly phase: "request" } & ToolCorrelation)
  | (EventBase & {
      readonly type: "tool.denied"
      readonly phase: "authorization"
      readonly reason: string
    } & ToolCorrelation)
  | (EventBase & {
      readonly type: "tool.started"
      readonly phase: "execution"
    } & ToolAttemptCorrelation)
  | (EventBase & {
      readonly type: "tool.completed"
      readonly phase: "execution"
    } & ToolAttemptCorrelation)
  | (EventBase & { readonly type: "tool.failed"; readonly phase: "preparation" } & ToolCorrelation &
      FailureFields)
  | (EventBase & {
      readonly type: "tool.failed"
      readonly phase: "execution"
    } & ToolAttemptCorrelation &
      FailureFields)
  | (EventBase & {
      readonly type: "tool.cancelled"
      readonly phase: "execution"
    } & ToolAttemptCorrelation &
      CancellationFields)

type ApprovalCorrelation = ToolCorrelation & {
  readonly approvalId: ApprovalId
  readonly effectDigest: EffectDigest
}

export type ApprovalEvent =
  | (EventBase & { readonly type: "approval.requested" } & ApprovalCorrelation)
  | (EventBase & {
      readonly type: "approval.resolved"
      readonly approvalStatus: ApprovalStatus
    } & ApprovalCorrelation)

export type BudgetEvent = EventBase & {
  readonly type: "budget.exceeded"
  readonly resource: ExecutionBudgetResource
  readonly consumed?: number
  readonly requested?: number
  readonly limit?: number
}

export type HarnessEvent =
  | RunEvent
  | TurnEvent
  | ModelEvent
  | ToolEvent
  | ApprovalEvent
  | BudgetEvent

export type HarnessEventDetails = HarnessEvent extends infer Event
  ? Event extends HarnessEvent
    ? Omit<Event, "runId" | "sequence" | "occurredAt">
    : never
  : never

export type EventDelivery =
  | { readonly status: "delivered"; readonly event: HarnessEvent }
  | { readonly status: "failed"; readonly event: HarnessEvent; readonly failure: ExecutionFailure }

export type TerminalEventDelivery = EventDelivery
export type RunFinalization = {
  readonly outcome: import("./contracts.ts").RunOutcome
  readonly terminalDelivery: TerminalEventDelivery
}
