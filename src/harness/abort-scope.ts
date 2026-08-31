import { ExecutionCancelledError, ExecutionHarnessError } from "./errors.ts"

export type AbortScope = {
  readonly signal: AbortSignal
  readonly deadline: number
  readonly dispose: () => void
}

export type AbortableOperation<T> = PromiseLike<T> | ((signal: AbortSignal) => PromiseLike<T> | T)

export function createAbortScope(
  parent: AbortSignal | undefined,
  timeoutMs: number,
  timeoutError: ExecutionHarnessError,
): AbortScope {
  const controller = new AbortController()
  const deadline = Date.now() + timeoutMs
  const onParentAbort = (): void => {
    controller.abort(abortReason(parent))
  }

  if (parent?.aborted === true) {
    onParentAbort()
  } else {
    parent?.addEventListener("abort", onParentAbort, { once: true })
  }

  const timeout = setTimeout(() => controller.abort(timeoutError), timeoutMs)

  return {
    signal: controller.signal,
    deadline,
    dispose: () => {
      clearTimeout(timeout)
      parent?.removeEventListener("abort", onParentAbort)
    },
  }
}

export async function runAbortable<T>(
  scope: AbortScope,
  operation: (signal: AbortSignal) => PromiseLike<T> | T,
): Promise<T> {
  return runAbortableOperation(scope.signal, operation)
}

export function runAbortableOperation<T>(
  signal: AbortSignal,
  operation: AbortableOperation<T>,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortReason(signal))
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
      settle(() => reject(abortReason(signal)))
    }
    signal.addEventListener("abort", onAbort, { once: true })

    const operationPromise =
      typeof operation === "function"
        ? Promise.resolve().then(() => {
            if (settled) {
              return Promise.reject<T>(abortReason(signal))
            }
            return operation(signal)
          })
        : Promise.resolve(operation)

    operationPromise.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    )
  })
}

export function abortReason(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason
  return reason instanceof ExecutionHarnessError ? reason : new ExecutionCancelledError()
}

export async function waitForSettlement(
  operation: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      resolve(false)
    }, timeoutMs)

    operation.then(
      () => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeout)
        resolve(true)
      },
      () => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeout)
        resolve(true)
      },
    )
  })
}
