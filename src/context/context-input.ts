import type { AgentMessage, ModelContinuation, ToolDefinition } from "../core/index.ts"
import type { MemoryProjection } from "../memory/index.ts"
import type { ModelInput } from "../model/index.ts"
import type { BoundContinuation, ContextViewId, SessionSnapshot } from "../session/index.ts"

export type InstructionProfile =
  | { readonly type: "empty" }
  | {
      readonly type: "instructions"
      readonly instructions: string
      readonly fingerprint: string
    }

export type ContextInput = {
  readonly messages: readonly AgentMessage[]
  readonly tools: readonly ToolDefinition[]
  readonly instructionProfile?: InstructionProfile
  readonly continuation?: ModelContinuation
}

export type ContextViewInput = {
  readonly messages: readonly AgentMessage[]
  readonly tools: readonly ToolDefinition[]
  readonly contextViewId: ContextViewId
  readonly instructionProfile?: InstructionProfile
  readonly continuation?: BoundContinuation
  readonly memoryProjection?: MemoryProjection
}

export type SessionContextInput = {
  readonly snapshot: SessionSnapshot
  readonly tools: readonly ToolDefinition[]
  readonly instructionProfile?: InstructionProfile
  readonly memoryProjection?: MemoryProjection
}

export type ContextAssembly = {
  readonly input: ModelInput
  readonly contextViewId: ContextViewId
  readonly instructionFingerprint?: string
  readonly memoryFingerprint?: string
}
