import { z } from "zod"
import type {
  Capability,
  ModelOutput,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "../core/index.ts"
import { type EffectDigest, EffectDigestSchema } from "../tool/effect-digest.ts"
import type { PreparedToolCall } from "../tool/index.ts"
import type { HarnessEvent } from "./event-contracts.ts"

export const RunIdSchema = z.string().uuid().brand("RunId")
export const TurnIdSchema = z.string().uuid().brand("TurnId")
export const ItemIdSchema = z.string().uuid().brand("ItemId")
export const AttemptIdSchema = z.string().uuid().brand("AttemptId")
export const ApprovalIdSchema = z.string().uuid().brand("ApprovalId")
export const AttemptNumberSchema = z.number().int().positive().brand("AttemptNumber")

export type RunId = z.infer<typeof RunIdSchema>
export type TurnId = z.infer<typeof TurnIdSchema>
export type ItemId = z.infer<typeof ItemIdSchema>
export type AttemptId = z.infer<typeof AttemptIdSchema>
export type ApprovalId = z.infer<typeof ApprovalIdSchema>
export type AttemptNumber = z.infer<typeof AttemptNumberSchema>
export type { EffectDigest }
export { EffectDigestSchema }

export type ExecutionBudgetResource = "turns" | "model_calls" | "tool_calls"
export type ExecutionFailureScope = "run" | "turn" | "model" | "tool" | "approval"
export type ExecutionFailureKind =
  | "cancelled"
  | "blocked"
  | "budget_exceeded"
  | "timeout"
  | "cleanup_timeout"
  | "event_sink"
  | "execution"
  | "model"
  | "tool"
  | "approval"
  | "invariant"

export type ExecutionFailure = {
  readonly kind: ExecutionFailureKind
  readonly message: string
  readonly displayReason: string
  readonly retryable: boolean
  readonly scope?: ExecutionFailureScope
  readonly resource?: ExecutionBudgetResource
}

export type RunOutcome =
  | {
      readonly type: "completed"
      readonly reason?: never
      readonly displayReason?: never
      readonly failure?: never
    }
  | {
      readonly type: "blocked"
      readonly reason: string
      readonly displayReason?: string
      readonly failure?: ExecutionFailure
    }
  | {
      readonly type: "cancelled"
      readonly reason?: string
      readonly displayReason?: string
      readonly failure?: ExecutionFailure
    }
  | {
      readonly type: "failed"
      readonly reason: string
      readonly displayReason?: string
      readonly failure: ExecutionFailure
    }

export type ExecutionBudget = {
  readonly maxTurns: number
  readonly maxModelCalls: number
  readonly maxToolCalls: number
  readonly maxRunTimeMs: number
  readonly modelTimeoutMs: number
  readonly toolTimeoutMs: number
  readonly approvalTimeoutMs: number
  readonly cleanupTimeoutMs: number
}

export type StartRunInput = {
  readonly signal?: AbortSignal
}

export type RunContext = {
  readonly runId: RunId
  readonly signal: AbortSignal
}

export type TurnContext = RunContext & {
  readonly turnId: TurnId
  readonly index: number
}

export type ExecutionAttemptContext = TurnContext & {
  readonly itemId: ItemId
  readonly attempt: AttemptNumber
  readonly attemptId: AttemptId
  readonly effectDigest?: EffectDigest
  readonly signal: AbortSignal
  readonly deadline: number
}

export type ApprovalStatus = "approved" | "denied" | "expired" | "cancelled"

export type {
  ApprovalEvent,
  BudgetEvent,
  EventDelivery,
  HarnessEvent,
  HarnessEventDetails,
  HarnessEventType,
  ModelEvent,
  RunEvent,
  RunFinalization,
  TerminalEventDelivery,
  ToolEvent,
  TurnEvent,
} from "./event-contracts.ts"

export interface EventSink {
  emit(event: HarnessEvent, signal?: AbortSignal): Promise<void>
}

export interface ToolExposurePolicy {
  filter(tools: readonly ToolDefinition[], context: RunContext): readonly ToolDefinition[]
}

export type PolicyDecision =
  | { readonly type: "allow" }
  | { readonly type: "deny"; readonly reason: string }
  | { readonly type: "ask"; readonly reason: string }

export type CapabilityPolicyRequest = TurnContext & {
  readonly toolCallId: string
  readonly toolName: string
  readonly capabilities: readonly Capability[]
  readonly toolIdentity: import("../core/index.ts").ToolIdentity
  readonly effectDigest: EffectDigest
}

export interface CapabilityPolicy {
  evaluate(request: CapabilityPolicyRequest): PolicyDecision | Promise<PolicyDecision>
}

export interface ToolSandbox {
  execute(
    prepared: PreparedToolCall,
    context: import("../core/index.ts").ToolExecutionContext,
    invoke: (context: import("../core/index.ts").ToolExecutionContext) => Promise<ToolResult>,
  ): Promise<ToolResult>
}

export type ApprovalRequest = CapabilityPolicyRequest & {
  readonly approvalId: ApprovalId
  readonly itemId: ItemId
  readonly reason: string
  readonly createdAt: number
}

export type ApprovalResult = {
  readonly approvalId: ApprovalId
  readonly effectDigest: EffectDigest
  readonly status: ApprovalStatus
}

export type ApprovalResolution = ApprovalResult

export interface ApprovalBroker {
  request(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalResult>
}

export type CompletionDecision =
  | { readonly type: "accept" }
  | { readonly type: "blocked"; readonly reason: string }

export type CompletionContext = TurnContext & {
  readonly nonterminalItemCount: number
  readonly executingAttemptCount: number
  readonly pendingApprovalCount: number
}

export type ItemState =
  | "created"
  | "awaiting_approval"
  | "executing"
  | "completed"
  | "failed"
  | "denied"
  | "cancelled"

export interface CompletionGate {
  evaluate(context: CompletionContext, output: ModelOutput): Promise<CompletionDecision>
}

export interface RunExecution {
  readonly context: RunContext
  readonly exposedTools: readonly ToolDefinition[]
  withTurn<T>(operation: (turn: TurnExecution) => Promise<T>): Promise<T>
}

export interface TurnExecution {
  readonly context: TurnContext
  executeModel(
    operation: (context: ExecutionAttemptContext) => Promise<ModelOutput>,
  ): Promise<ModelOutput>
  executeTools(calls: readonly ToolCall[]): Promise<readonly ToolResult[]>
  evaluateCompletion(output: ModelOutput): Promise<void>
}
