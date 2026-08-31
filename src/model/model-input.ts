import type { AgentMessage, ModelContinuation, ToolDefinition } from "../core/index.ts"

export type ModelInput = {
  readonly instructions?: string
  readonly messages: readonly AgentMessage[]
  readonly tools: readonly ToolDefinition[]
  readonly continuation?: ModelContinuation
}
