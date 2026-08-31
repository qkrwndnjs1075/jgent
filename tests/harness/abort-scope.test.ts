import { expect, test } from "bun:test"
import { runAbortableOperation } from "../../src/harness/abort-scope.ts"
import { ExecutionCancelledError } from "../../src/harness/errors.ts"

test("rejects an arbitrary pending operation when its signal aborts", async () => {
  // Given
  const controller = new AbortController()
  const deferred = Promise.withResolvers<string>()
  const operation = runAbortableOperation(controller.signal, deferred.promise)

  // When
  controller.abort()

  // Then
  await expect(operation).rejects.toBeInstanceOf(ExecutionCancelledError)

  deferred.resolve("late result")
  await Promise.resolve()
})

test("accepts a synchronous control-plane operation and forwards the signal", async () => {
  // Given
  const controller = new AbortController()
  let observedSignal: AbortSignal | undefined

  // When
  const result = await runAbortableOperation(controller.signal, (signal) => {
    observedSignal = signal
    return "result"
  })

  // Then
  expect(result).toBe("result")
  expect(observedSignal).toBe(controller.signal)
})
