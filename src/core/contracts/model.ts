import type { ToolCall } from "./tool.ts"

export type ModelContinuation = {
  readonly provider: string
  readonly state: string
  readonly consumedMessageCount: number
}

export type ModelOutput =
  | {
      readonly stopReason: "tool_calls"
      readonly content?: string
      readonly toolCalls: readonly [ToolCall, ...ToolCall[]]
      readonly continuation?: ModelContinuation
    }
  | {
      readonly stopReason: "completed"
      readonly content: string
      readonly toolCalls: readonly []
      readonly continuation?: ModelContinuation
    }
