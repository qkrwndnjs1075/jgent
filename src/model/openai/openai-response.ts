import { z } from "zod"
import type { ModelOutput, ToolCall } from "../../core/index.ts"
import { ModelError } from "../model-error.ts"
import type { ModelInput } from "../model-input.ts"

const outputTextSchema = z.object({
  type: z.literal("output_text"),
  text: z.string(),
})

const refusalSchema = z.object({
  type: z.literal("refusal"),
  refusal: z.string(),
})

const outputMessageSchema = z.object({
  type: z.literal("message"),
  status: z.enum(["in_progress", "completed", "incomplete"]),
  content: z.array(z.union([outputTextSchema, refusalSchema])),
})

const functionCallSchema = z.object({
  type: z.literal("function_call"),
  call_id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.string(),
  status: z.enum(["in_progress", "completed", "incomplete"]).optional(),
})

const reasoningSchema = z
  .object({
    type: z.literal("reasoning"),
  })
  .loose()

const outputItemEnvelopeSchema = z
  .object({
    type: z.string(),
  })
  .loose()

const responseSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(["completed", "failed", "in_progress", "cancelled", "queued", "incomplete"]),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
      })
      .nullable()
      .optional(),
    incomplete_details: z
      .object({
        reason: z.string(),
      })
      .nullable()
      .optional(),
    output: z.array(outputItemEnvelopeSchema),
  })
  .loose()

const argumentsSchema = z.record(z.string(), z.unknown())

export function toOpenAIModelOutput(response: unknown, input: ModelInput): ModelOutput {
  const parsed = responseSchema.safeParse(response)

  if (!parsed.success) {
    throw modelError("invalid_response", "Malformed OpenAI response", false)
  }

  requireCompletedStatus(parsed.data)

  const textParts: string[] = []
  const toolCalls: ToolCall[] = []

  for (const item of parsed.data.output) {
    switch (item.type) {
      case "message": {
        const message = parseOutputItem(outputMessageSchema, item)
        if (message.status !== "completed") {
          throw modelError("invalid_response", "Incomplete OpenAI output message", false)
        }

        for (const part of message.content) {
          switch (part.type) {
            case "output_text":
              textParts.push(part.text)
              break
            case "refusal":
              throw modelError("refusal", "OpenAI refused the response", false)
            default:
              assertNever(part)
          }
        }
        break
      }
      case "function_call": {
        const call = parseOutputItem(functionCallSchema, item)
        if (call.status !== undefined && call.status !== "completed") {
          throw modelError("invalid_response", "Incomplete OpenAI function call", false)
        }
        toolCalls.push({
          id: call.call_id,
          name: call.name,
          arguments: parseArguments(call.arguments),
        })
        break
      }
      case "reasoning":
        parseOutputItem(reasoningSchema, item)
        break
      default:
        throw modelError("invalid_response", "Unsupported OpenAI output item", false)
    }
  }

  const content = textParts.join("")
  const continuation = {
    provider: "openai",
    state: parsed.data.id,
    consumedMessageCount: input.messages.length + 1,
  } as const
  const [firstToolCall, ...remainingToolCalls] = toolCalls

  if (firstToolCall !== undefined) {
    const calls = [firstToolCall, ...remainingToolCalls] as const
    return content.length === 0
      ? { stopReason: "tool_calls", toolCalls: calls, continuation }
      : { stopReason: "tool_calls", content, toolCalls: calls, continuation }
  }

  if (content.length === 0) {
    throw modelError("invalid_response", "OpenAI returned no usable output", false)
  }

  return {
    stopReason: "completed",
    content,
    toolCalls: [],
    continuation,
  }
}

type ParsedResponse = z.infer<typeof responseSchema>

function requireCompletedStatus(response: ParsedResponse): void {
  switch (response.status) {
    case "completed":
      if (response.error !== undefined && response.error !== null) {
        throw modelError("provider_response", "OpenAI completed with an error", false)
      }
      return
    case "failed":
      throw modelError(
        "provider_response",
        "OpenAI response failed",
        response.error?.code === "server_error" || response.error?.code === "rate_limit_exceeded",
      )
    case "incomplete":
      throw modelError("incomplete", "OpenAI response was incomplete", false)
    case "cancelled":
      throw modelError("cancelled", "OpenAI response was cancelled", false)
    case "queued":
    case "in_progress":
      throw modelError(
        "invalid_response",
        `OpenAI returned non-terminal status ${response.status}`,
        true,
      )
    default:
      assertNever(response.status)
  }
}

function parseArguments(value: string): Readonly<Record<string, unknown>> {
  let decoded: unknown

  try {
    decoded = JSON.parse(value)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw modelError("invalid_response", "OpenAI function arguments are invalid JSON", false)
    }
    throw error
  }

  const parsed = argumentsSchema.safeParse(decoded)
  if (!parsed.success) {
    throw modelError("invalid_response", "OpenAI function arguments must be an object", false)
  }
  return parsed.data
}

function parseOutputItem<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw modelError("invalid_response", "Malformed OpenAI output item", false)
  }
  return parsed.data
}

function modelError(
  kind: ConstructorParameters<typeof ModelError>[0]["kind"],
  message: string,
  retryable: boolean,
): ModelError {
  return new ModelError({ kind, message, retryable })
}

function assertNever(value: never): never {
  throw modelError("invalid_response", `Unexpected OpenAI variant: ${String(value)}`, false)
}
