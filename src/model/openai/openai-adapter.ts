import type { FunctionTool, ResponseInputItem } from "openai/resources/responses/responses"
import type { AgentMessage, ToolDefinition, ToolResult } from "../../core/index.ts"
import { ModelError } from "../model-error.ts"
import type { ModelInput } from "../model-input.ts"
import type { ProviderAdapter } from "../provider-adapter.ts"
import { toOpenAIModelOutput } from "./openai-response.ts"
import type { OpenAIModel, OpenAIRequest } from "./openai-types.ts"

export type OpenAIAdapterOptions = {
  readonly model: OpenAIModel
}

export class OpenAIAdapter implements ProviderAdapter<OpenAIRequest> {
  constructor(private readonly options: OpenAIAdapterOptions) {}

  toRequest(input: ModelInput): OpenAIRequest {
    const continuation = input.continuation
    const startIndex = continuation?.consumedMessageCount ?? 0

    if (continuation !== undefined) {
      validateContinuation(continuation, input.messages.length)
    }

    const request: OpenAIRequest = {
      model: this.options.model,
      input: input.messages.slice(startIndex).flatMap(toResponseItems),
      tools: input.tools.map(toFunctionTool),
      parallel_tool_calls: true,
      store: true,
      ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
    }

    if (continuation === undefined) {
      return request
    }

    return {
      ...request,
      previous_response_id: continuation.state,
    }
  }

  toOutput(response: unknown, input: ModelInput) {
    return toOpenAIModelOutput(response, input)
  }
}

function validateContinuation(
  continuation: NonNullable<ModelInput["continuation"]>,
  messageCount: number,
): void {
  const isValid =
    continuation.provider === "openai" &&
    continuation.state.length > 0 &&
    Number.isInteger(continuation.consumedMessageCount) &&
    continuation.consumedMessageCount >= 0 &&
    continuation.consumedMessageCount <= messageCount

  if (!isValid) {
    throw new ModelError({
      kind: "invalid_continuation",
      message: "Invalid OpenAI continuation",
      retryable: false,
    })
  }
}

function toFunctionTool(definition: ToolDefinition): FunctionTool {
  return {
    type: "function",
    name: definition.name,
    description: definition.description,
    parameters: definition.inputSchema,
    strict: false,
  }
}

function toResponseItems(message: AgentMessage): readonly ResponseInputItem[] {
  switch (message.role) {
    case "system":
    case "user":
      return [{ role: message.role, content: message.content }]
    case "assistant": {
      if (message.toolCalls === undefined) {
        return [{ role: "assistant", content: message.content }]
      }

      const contentItems: readonly ResponseInputItem[] =
        message.content === undefined ? [] : [{ role: "assistant", content: message.content }]
      const callItems: readonly ResponseInputItem[] = message.toolCalls.map((call) => ({
        type: "function_call",
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      }))
      return [...contentItems, ...callItems]
    }
    case "tool":
      return [
        {
          type: "function_call_output",
          call_id: message.result.toolCallId,
          output: toFunctionOutput(message.result),
        },
      ]
    default:
      return assertNever(message)
  }
}

function toFunctionOutput(result: ToolResult): string {
  if (result.success) {
    return result.output
  }

  return JSON.stringify({
    success: false,
    output: result.output,
    error: result.error,
  })
}

function assertNever(value: never): never {
  throw new ModelError({
    kind: "invalid_response",
    message: `Unsupported agent message: ${String(value)}`,
    retryable: false,
  })
}
