import type {
  Capability,
  ToolCall,
  ToolExecutionContext,
  ToolExecutionDescriptor,
  ToolExecutionFailure,
  ToolExecutionResult,
  ToolIdentity,
  ToolResult,
} from "../core/contracts/tool.ts"
import {
  computeEffectDigest,
  deepFreeze,
  type EffectDigest,
  EffectDigestSchema,
} from "./effect-digest.ts"
import type { PreparedToolExecution, ToolRegistry } from "./tool-registry.ts"
import type { ToolValidator } from "./tool-validator.ts"

export class ToolRuntime {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly validator: ToolValidator,
    private readonly options: ToolRuntimeOptions = {},
  ) {}

  has(name: string): boolean {
    return this.registry.get(name) !== undefined
  }

  prepare(call: ToolCall): ToolPreparationResult {
    const transformed = this.options.transform?.(call) ?? call
    const registeredTool = this.registry.get(transformed.name)

    if (registeredTool === undefined) {
      return {
        valid: false,
        result: toolFailure(call.id, `Unknown tool: ${transformed.name}`),
      }
    }

    const preparation = registeredTool.prepare(this.validator, transformed.arguments)

    if (!preparation.valid) {
      return {
        valid: false,
        result: toolFailure(
          call.id,
          `Invalid arguments for tool "${transformed.name}": ${preparation.error}`,
        ),
      }
    }

    const effectDigest = EffectDigestSchema.parse(
      computeEffectDigest({
        toolIdentity: preparation.toolIdentity,
        input: preparation.input,
        capabilities: preparation.capabilities,
        executionDescriptor: preparation.executionDescriptor,
      }),
    )

    return {
      valid: true,
      prepared: deepFreeze({
        callId: call.id,
        toolIdentity: preparation.toolIdentity,
        tool: preparation.toolIdentity,
        input: preparation.input,
        capabilities: preparation.capabilities,
        executionDescriptor: preparation.executionDescriptor,
        effectDigest,
        execute: preparation.execute,
        toolCallId: call.id,
        toolName: transformed.name,
        execution: preparation,
      }),
    }
  }

  async executePrepared(
    prepared: PreparedToolCall,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      const result = await prepared.execute(context)
      return {
        toolCallId: prepared.callId,
        ...result,
      }
    } catch (error) {
      const failure: ToolExecutionFailure =
        error instanceof Error
          ? { kind: "thrown", name: error.name, message: error.message }
          : { kind: "thrown", name: "UnknownFailure", message: "Unknown tool execution error" }
      return withFailure(toolFailure(prepared.callId, failure.message), failure)
    }
  }

  async execute(
    call: ToolCall,
    context: ToolExecutionContext = { signal: new AbortController().signal },
  ): Promise<ToolResult> {
    const preparation = this.prepare(call)
    return preparation.valid
      ? this.executePrepared(preparation.prepared, context)
      : preparation.result
  }
}

export type PreparedToolCall = {
  readonly callId: string
  readonly toolIdentity: ToolIdentity
  readonly tool: ToolIdentity
  readonly input: object
  readonly capabilities: readonly Capability[]
  readonly executionDescriptor: ToolExecutionDescriptor
  readonly effectDigest: EffectDigest
  readonly execute: (context: ToolExecutionContext) => Promise<ToolExecutionResult>

  readonly toolCallId: string
  readonly toolName: string
  readonly execution: Extract<PreparedToolExecution, { readonly valid: true }>
}

export type ToolCallTransform = (call: ToolCall) => ToolCall
export type ToolRuntimeOptions = {
  readonly transform?: ToolCallTransform
}

export type ToolPreparationResult =
  | {
      readonly valid: true
      readonly prepared: PreparedToolCall
    }
  | {
      readonly valid: false
      readonly result: ToolResult
    }

function toolFailure(toolCallId: string, error: string): ToolResult {
  return {
    toolCallId,
    success: false,
    output: "",
    error,
  }
}

function withFailure(result: ToolResult, failure: ToolExecutionFailure): ToolResult {
  Object.defineProperty(result, "failure", {
    configurable: false,
    enumerable: false,
    value: deepFreeze(failure),
    writable: false,
  })
  return Object.freeze(result)
}
