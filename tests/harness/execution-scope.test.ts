import { expect, test } from "bun:test"
import {
  ExecutionScope,
  type ExecutionScopeCloseResult,
} from "../../src/harness/execution-scope.ts"

test("joins a registered child before closing a retained scope", async () => {
  // Given
  const scope = new ExecutionScope({ cleanupTimeoutMs: 100 })
  const childReleased = Promise.withResolvers<void>()
  const child = scope.spawn(async () => {
    await childReleased.promise
  })

  // When
  const closePromise = scope.close()

  // Then
  expect(scope.state).toBe("closing")
  expect(scope.signal.aborted).toBe(false)
  expect(scope.childCount).toBe(1)

  childReleased.resolve()
  await child
  const result = await closePromise
  expect(result).toEqual<ExecutionScopeCloseResult>({
    type: "joined",
    pendingChildCount: 0,
  })
  expect(scope.state).toBe("closed")
})

test("propagates parent cancellation to a child", async () => {
  // Given
  const parent = new AbortController()
  const scope = new ExecutionScope({ parent: parent.signal, cleanupTimeoutMs: 100 })
  const observed = Promise.withResolvers<unknown>()
  const child = scope.spawn(async (signal) => {
    signal.addEventListener("abort", () => observed.resolve(signal.reason), { once: true })
    await new Promise<void>(() => {})
  })

  // When
  const reason = new Error("parent cancelled")
  parent.abort(reason)

  // Then
  expect(scope.signal.aborted).toBe(true)
  expect(await observed.promise).toBe(reason)
  const closePromise = scope.cancelAndJoin()
  const result = await closePromise
  expect(result.type).toBe("cleanup_timeout")
  expect(scope.state).toBe("closed")
  child.catch(() => undefined)
})

test("joins fire-and-forget child rejection without an unhandled rejection", async () => {
  // Given
  const scope = new ExecutionScope({ cleanupTimeoutMs: 100 })
  const failure = new Error("child failed")

  // When
  const child = scope.spawn(async () => {
    throw failure
  })
  const result = await scope.close()

  // Then
  expect(result).toEqual<ExecutionScopeCloseResult>({
    type: "joined",
    pendingChildCount: 0,
  })
  await expect(child).rejects.toBe(failure)
})

test("rejects child registration once closing starts", async () => {
  // Given
  const scope = new ExecutionScope({ cleanupTimeoutMs: 100 })
  const closePromise = scope.close()

  // When
  expect(() => scope.spawn(async () => undefined)).toThrow()

  // Then
  await closePromise
  expect(() => scope.spawn(async () => undefined)).toThrow()
})

test("close is idempotent and returns the same join result", async () => {
  // Given
  const scope = new ExecutionScope({ cleanupTimeoutMs: 100 })

  // When
  const first = scope.close()
  const second = scope.close()

  // Then
  expect(second).toBe(first)
  expect(await first).toEqual<ExecutionScopeCloseResult>({
    type: "joined",
    pendingChildCount: 0,
  })
})
