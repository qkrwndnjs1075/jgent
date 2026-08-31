import { expect, test } from "bun:test"
import {
  InvalidItemTransitionError,
  ItemClaimConflictError,
  ItemRegistry,
} from "../../src/harness/item-registry.ts"

test("registers model and tool items without creating attempts", () => {
  // Given
  const registry = new ItemRegistry({ now: () => 100 })

  // When
  const model = registry.registerModel({ itemId: "model-1", turnId: "turn-1" })
  const tool = registry.registerTool({
    itemId: "tool-1",
    turnId: "turn-1",
    toolCallId: "call-1",
    toolName: "read_file",
  })

  // Then
  expect(model).toMatchObject({ itemId: "model-1", kind: "model", state: "created" })
  expect(tool).toMatchObject({
    itemId: "tool-1",
    kind: "tool",
    state: "created",
    toolCallId: "call-1",
    toolName: "read_file",
  })
  expect(model.attempts).toEqual([])
  expect(tool.attempts).toEqual([])
  expect(registry.nonterminalItemCount).toBe(2)
  expect(registry.executingAttemptCount).toBe(0)
  expect(registry.pendingApprovalCount).toBe(0)
})

test("creates an attempt only when the effect starts and derives active counts", () => {
  // Given
  const registry = new ItemRegistry({ now: () => 100 })
  registry.registerTool({
    itemId: "tool-1",
    toolCallId: "call-1",
    toolName: "shell",
  })

  // When
  registry.transition("tool-1", "awaiting_approval")
  expect(registry.pendingApprovalCount).toBe(1)
  const attempt = registry.startAttempt("tool-1")

  // Then
  expect(attempt.record.attemptNumber).toBe(1)
  expect(attempt.record.attemptId.length).toBeGreaterThan(0)
  expect(registry.get("tool-1")?.attempts).toHaveLength(1)
  expect(registry.executingAttemptCount).toBe(1)
  expect(registry.pendingApprovalCount).toBe(0)
  expect(registry.nonterminalItemCount).toBe(1)

  attempt.complete()
  expect(registry.executingAttemptCount).toBe(0)
  expect(registry.nonterminalItemCount).toBe(0)
  expect(registry.get("tool-1")?.state).toBe("completed")
})

test("rejects an illegal transition and preserves the item state", () => {
  // Given
  const registry = new ItemRegistry({ now: () => 100 })
  registry.registerModel({ itemId: "model-1" })

  // When
  expect(() => registry.transition("model-1", "completed")).toThrow(InvalidItemTransitionError)

  // Then
  expect(registry.get("model-1")?.state).toBe("created")
})

test("allows only one concurrent claim for an item", () => {
  // Given
  const registry = new ItemRegistry()
  registry.registerModel({ itemId: "model-1" })
  const first = registry.claim("model-1")

  // When
  expect(() => registry.claim("model-1")).toThrow(ItemClaimConflictError)

  // Then
  first.release()
  expect(() => registry.claim("model-1")).not.toThrow()
})

test("tracks pending approval separately from executing attempts", () => {
  // Given
  const registry = new ItemRegistry()
  registry.registerTool({
    itemId: "tool-1",
    toolCallId: "call-1",
    toolName: "write_file",
  })

  // When
  registry.transition("tool-1", "awaiting_approval")

  // Then
  expect(registry.nonterminalItemCount).toBe(1)
  expect(registry.pendingApprovalCount).toBe(1)
  expect(registry.executingAttemptCount).toBe(0)
})
