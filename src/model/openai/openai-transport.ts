import OpenAI from "openai"
import type { APIError } from "openai/core/error"
import type { ApiKeyCredential } from "../../auth/index.ts"
import { ModelError } from "../model-error.ts"
import type { ModelTransport, ModelTransportContext } from "../model-transport.ts"
import type { OpenAIRequest } from "./openai-types.ts"

export type OpenAITransportOptions = {
  readonly baseURL?: string
  readonly timeoutMs?: number
}

export class OpenAITransport implements ModelTransport<OpenAIRequest, ApiKeyCredential> {
  constructor(private readonly options: OpenAITransportOptions = {}) {}

  async send(
    request: OpenAIRequest,
    credential: ApiKeyCredential,
    context: ModelTransportContext,
  ): Promise<unknown> {
    if (context.signal.aborted) {
      throw new ModelError({
        kind: "cancelled",
        message: "OpenAI request was cancelled",
        retryable: false,
      })
    }

    const client = new OpenAI({
      apiKey: credential.value,
      maxRetries: 0,
      timeout: this.options.timeoutMs ?? 120_000,
      ...(this.options.baseURL === undefined ? {} : { baseURL: this.options.baseURL }),
    })

    try {
      return await client.responses.create(request, { signal: context.signal })
    } catch (error) {
      if (context.signal.aborted) {
        throw new ModelError({
          kind: "cancelled",
          message: "OpenAI request was cancelled",
          retryable: false,
        })
      }
      if (error instanceof Error) {
        throw toModelError(error)
      }
      throw error
    }
  }
}

function toModelError(error: Error): ModelError {
  if (error instanceof OpenAI.AuthenticationError) {
    return fromApiError(error, {
      kind: "authentication",
      message: "OpenAI authentication failed",
      retryable: false,
    })
  }
  if (error instanceof OpenAI.PermissionDeniedError) {
    return fromApiError(error, {
      kind: "permission",
      message: "OpenAI permission denied",
      retryable: false,
    })
  }
  if (error instanceof OpenAI.RateLimitError) {
    return fromApiError(error, {
      kind: "rate_limit",
      message: "OpenAI rate limit exceeded",
      retryable: true,
    })
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new ModelError({
      kind: "timeout",
      message: "OpenAI request timed out",
      retryable: true,
    })
  }
  if (error instanceof OpenAI.APIUserAbortError) {
    return new ModelError({
      kind: "cancelled",
      message: "OpenAI request was cancelled",
      retryable: false,
    })
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new ModelError({
      kind: "transport",
      message: "OpenAI connection failed",
      retryable: true,
    })
  }
  if (error instanceof OpenAI.APIError) {
    return fromApiError(error, {
      kind: "provider_response",
      message: "OpenAI API request failed",
      retryable: error.status === undefined || error.status >= 500,
    })
  }
  return new ModelError({
    kind: "transport",
    message: "Unexpected OpenAI transport failure",
    retryable: false,
  })
}

type ApiErrorOptions = {
  readonly kind: ConstructorParameters<typeof ModelError>[0]["kind"]
  readonly message: string
  readonly retryable: boolean
}

function fromApiError(error: APIError, options: ApiErrorOptions): ModelError {
  return new ModelError({
    ...options,
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(error.requestID === undefined || error.requestID === null
      ? {}
      : { requestId: error.requestID }),
  })
}
