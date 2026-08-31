import type { ModelOutput } from "../core/index.ts"
import type { ModelInput } from "./model-input.ts"

export interface ProviderAdapter<TRequest> {
  toRequest(input: ModelInput): TRequest
  toOutput(response: unknown, input: ModelInput): ModelOutput
}
