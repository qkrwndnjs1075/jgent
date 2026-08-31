import type { ModelOutput } from "../core/index.ts"
import type { ModelInput } from "./model-input.ts"

export interface ModelClient {
  generate(input: ModelInput, context?: ModelExecutionContext): Promise<ModelOutput>
}

export type ModelExecutionContext = {
  readonly signal: AbortSignal
}

export type AbortableModelOperation<T> = PromiseLike<T> | (() => PromiseLike<T> | T)

export function runAbortableOperation<T>(
  signal: AbortSignal,
  operation: AbortableModelOperation<T>,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortSignalReason(signal))
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort)
    }
    const settle = (settlement: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      settlement()
    }
    const onAbort = (): void => {
      settle(() => reject(abortSignalReason(signal)))
    }
    signal.addEventListener("abort", onAbort, { once: true })

    const operationPromise =
      typeof operation === "function"
        ? Promise.resolve().then(() => {
            if (settled) {
              throw abortSignalReason(signal)
            }
            return operation()
          })
        : Promise.resolve(operation)

    operationPromise.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    )
  })
}

function abortSignalReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The model operation was aborted", "AbortError")
}
