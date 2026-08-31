import type { ApiKeyCredential, AuthProvider } from "../../auth/index.ts"
import type { ModelOutput } from "../../core/index.ts"
import {
  type ModelClient,
  type ModelExecutionContext,
  runAbortableOperation,
} from "../model-client.ts"
import { ModelError } from "../model-error.ts"
import type { ModelInput } from "../model-input.ts"
import type { ModelTransport } from "../model-transport.ts"
import type { ProviderAdapter } from "../provider-adapter.ts"
import type { OpenAIRequest } from "./openai-types.ts"

export class OpenAIModelClient implements ModelClient {
  constructor(
    private readonly auth: AuthProvider<ApiKeyCredential>,
    private readonly adapter: ProviderAdapter<OpenAIRequest>,
    private readonly transport: ModelTransport<OpenAIRequest, ApiKeyCredential>,
  ) {}

  async generate(input: ModelInput, context?: ModelExecutionContext): Promise<ModelOutput> {
    const executionContext = context ?? { signal: new AbortController().signal }

    try {
      throwIfAborted(executionContext.signal)
      const credential = await runAbortableOperation(executionContext.signal, () =>
        this.auth.getCredential(),
      )
      throwIfAborted(executionContext.signal)
      const request = this.adapter.toRequest(input)
      throwIfAborted(executionContext.signal)
      const response = await runAbortableOperation(executionContext.signal, () =>
        this.transport.send(request, credential, executionContext),
      )
      throwIfAborted(executionContext.signal)
      return this.adapter.toOutput(response, input)
    } catch (error) {
      if (executionContext.signal.aborted) {
        throw toCancellationError()
      }
      throw error
    }
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw toCancellationError()
  }
}

function toCancellationError(): ModelError {
  return new ModelError({
    kind: "cancelled",
    message: "Model request was cancelled",
    retryable: false,
  })
}
