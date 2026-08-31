import { expect, jest, test } from "bun:test"
import {
  ExecutionBudgetExceededError,
  ExecutionHarnessError,
  type ModelOutput,
  type Tool,
  type ToolCall,
} from "../../src/index.ts"
import { createHarnessFixture, TEST_BUDGET } from "./harness-test-fixtures.ts"

type CounterInput = {
  readonly label: string
}

test("rejects an oversized Tool batch atomically", async () => {
  // Given
  let executionCount = 0
  const tool: Tool<CounterInput> = {
    definition: {
      name: "counter",
      description: "Counts execution",
      inputSchema: {
        type: "object",
        properties: { label: { type: "string" } },
        required: ["label"],
        additionalProperties: false,
      },
    },
    capabilities: () => [],
    execute: async (input) => {
      executionCount += 1
      return { success: true, output: input.label }
    },
  }
  const { harness, events } = createHarnessFixture({
    tools: [tool],
    budget: { ...TEST_BUDGET, maxToolCalls: 1 },
  })
  const calls: readonly [ToolCall, ToolCall] = [
    { id: "call_a", name: "counter", arguments: { label: "A" } },
    { id: "call_b", name: "counter", arguments: { label: "B" } },
  ]

  // When
  let caught: unknown
  try {
    await harness.withRun({}, (run) =>
      run.withTurn(async (turn) => {
        const output = await turn.executeModel(async () => ({
          stopReason: "tool_calls",
          toolCalls: calls,
        }))
        return turn.executeTools(output.toolCalls)
      }),
    )
  } catch (error) {
    if (error instanceof ExecutionBudgetExceededError) {
      caught = error
    } else {
      throw error
    }
  }

  // Then
  expect(caught).toBeInstanceOf(ExecutionBudgetExceededError)
  expect(caught).toMatchObject({ resource: "tool_calls", consumed: 0, requested: 2, limit: 1 })
  expect(executionCount).toBe(0)
  expect(events.events.some(({ type }) => type === "tool.requested")).toBe(false)
  expect(events.events.at(-1)?.type).toBe("run.blocked")
})

test("blocks a new Turn before invoking its callback when the Turn budget is exhausted", async () => {
  // Given
  const { harness, events } = createHarnessFixture({
    budget: { ...TEST_BUDGET, maxTurns: 1 },
  })
  let callbackCount = 0

  // When
  let caught: unknown
  try {
    await harness.withRun({}, async (run) => {
      await run.withTurn(async () => {
        callbackCount += 1
      })
      await run.withTurn(async () => {
        callbackCount += 1
      })
    })
  } catch (error) {
    if (error instanceof ExecutionBudgetExceededError) {
      caught = error
    } else {
      throw error
    }
  }

  // Then
  expect(caught).toBeInstanceOf(ExecutionBudgetExceededError)
  expect(callbackCount).toBe(1)
  expect(events.events.filter(({ type }) => type === "turn.started")).toHaveLength(1)
})

test("blocks a model attempt before its callback when the model-call budget is exhausted", async () => {
  // Given
  const { harness } = createHarnessFixture({
    budget: { ...TEST_BUDGET, maxTurns: 2, maxModelCalls: 1 },
  })
  let modelCallCount = 0

  // When
  let caught: unknown
  try {
    await harness.withRun({}, async (run) => {
      await run.withTurn(async (turn) => {
        const output = await turn.executeModel(async () => {
          modelCallCount += 1
          return { stopReason: "completed", content: "first", toolCalls: [] }
        })
        await turn.evaluateCompletion(output)
      })
      await run.withTurn(async (turn) => {
        const output = await turn.executeModel(async () => {
          modelCallCount += 1
          return { stopReason: "completed", content: "second", toolCalls: [] }
        })
        await turn.evaluateCompletion(output)
      })
    })
  } catch (error) {
    if (error instanceof ExecutionBudgetExceededError) {
      caught = error
    } else {
      throw error
    }
  }

  // Then
  expect(caught).toBeInstanceOf(ExecutionBudgetExceededError)
  expect(modelCallCount).toBe(1)
})

test("stops an operation that exceeds the total Run time budget", async () => {
  // Given
  jest.useFakeTimers()
  const { harness, events } = createHarnessFixture({
    budget: { ...TEST_BUDGET, maxRunTimeMs: 25, modelTimeoutMs: 5_000 },
  })
  const started = Promise.withResolvers<void>()

  try {
    // When
    const execution = harness.withRun({}, (run) =>
      run.withTurn((turn) =>
        turn.executeModel(() => {
          started.resolve()
          return new Promise<ModelOutput>(() => {})
        }),
      ),
    )
    await started.promise
    jest.advanceTimersByTime(25)
    let caught: unknown
    try {
      await execution
    } catch (error) {
      if (error instanceof ExecutionHarnessError) {
        caught = error
      } else {
        throw error
      }
    }

    // Then
    expect(caught).toBeInstanceOf(ExecutionHarnessError)
    expect(caught).toMatchObject({ outcome: { type: "blocked" } })
    expect(events.events.at(-1)?.type).toBe("run.blocked")
  } finally {
    jest.useRealTimers()
  }
})

test("fails a model attempt that exceeds its timeout", async () => {
  // Given
  jest.useFakeTimers()
  const { harness, events } = createHarnessFixture({
    budget: { ...TEST_BUDGET, modelTimeoutMs: 25 },
  })
  const started = Promise.withResolvers<void>()

  try {
    // When
    const execution = harness.withRun({}, (run) =>
      run.withTurn((turn) =>
        turn.executeModel(() => {
          started.resolve()
          return new Promise<ModelOutput>(() => {})
        }),
      ),
    )
    await started.promise
    jest.advanceTimersByTime(25)
    let caught: unknown
    try {
      await execution
    } catch (error) {
      if (error instanceof ExecutionHarnessError) {
        caught = error
      } else {
        throw error
      }
    }

    // Then
    expect(caught).toBeInstanceOf(ExecutionHarnessError)
    expect(caught).toMatchObject({ outcome: { type: "failed" } })
    expect(events.events.some(({ type }) => type === "model.failed")).toBe(true)
  } finally {
    jest.useRealTimers()
  }
})
