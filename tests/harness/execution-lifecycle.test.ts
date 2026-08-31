import { expect, test } from "bun:test"
import {
  ExecutionEventSinkError,
  ExecutionHarnessError,
  type HarnessEvent,
  type ModelOutput,
  type Tool,
  type ToolCall,
} from "../../src/index.ts"
import { createHarnessFixture, TestInvariantError } from "./harness-test-fixtures.ts"

type EchoInput = {
  readonly value: string
}

const echoTool: Tool<EchoInput> = {
  definition: {
    name: "echo",
    description: "Echoes a value",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
  },
  capabilities: () => [],
  execute: async (input) => ({ success: true, output: input.value }),
}

test("emits ordered correlated events for one model and Tool turn", async () => {
  // Given
  const { harness, events } = createHarnessFixture({ tools: [echoTool] })
  const call: ToolCall = {
    id: "provider_call",
    name: "echo",
    arguments: { value: "secret-input" },
  }
  const output: ModelOutput = {
    stopReason: "tool_calls",
    toolCalls: [call],
  }

  // When
  const result = await harness.withRun({}, (run) =>
    run.withTurn(async (turn) => {
      await turn.executeModel(async () => output)
      const toolResults = await turn.executeTools(output.toolCalls)
      return toolResults[0]?.output ?? "missing"
    }),
  )

  // Then
  expect(result).toBe("secret-input")
  expect(events.events.map(({ type }) => type)).toEqual([
    "run.started",
    "turn.started",
    "model.started",
    "model.completed",
    "tool.requested",
    "tool.started",
    "tool.completed",
    "turn.completed",
    "run.completed",
  ])
  expect(events.events.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  expect(new Set(events.events.map(({ runId }) => runId)).size).toBe(1)

  const modelEvents = events.events.filter(
    (
      event,
    ): event is Extract<HarnessEvent, { readonly type: "model.started" | "model.completed" }> =>
      event.type === "model.started" || event.type === "model.completed",
  )
  expect(new Set(modelEvents.map(({ itemId }) => itemId)).size).toBe(1)
  const toolEvents = events.events.filter(
    (
      event,
    ): event is Extract<
      HarnessEvent,
      { readonly type: "tool.requested" | "tool.started" | "tool.completed" }
    > =>
      event.type === "tool.requested" ||
      event.type === "tool.started" ||
      event.type === "tool.completed",
  )
  expect(new Set(toolEvents.map(({ itemId }) => itemId)).size).toBe(1)
  expect(toolEvents.every((event) => event.toolCallId === "provider_call")).toBe(true)
  expect(JSON.stringify(events.events)).not.toContain("secret-input")
})

test("emits exactly one terminal outcome when nested execution fails", async () => {
  // Given
  const { harness, events } = createHarnessFixture()

  // When
  let caught: unknown
  try {
    await harness.withRun({}, (run) =>
      run.withTurn((turn) =>
        turn.executeModel(async () => {
          throw new TestInvariantError("model failed")
        }),
      ),
    )
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
  expect(
    events.events.filter(({ type }) =>
      ["run.completed", "run.blocked", "run.cancelled", "run.failed"].includes(type),
    ),
  ).toHaveLength(1)
  expect(events.events.at(-1)?.type).toBe("run.failed")
})

test("propagates caller cancellation into an active model attempt", async () => {
  // Given
  const { harness, events } = createHarnessFixture()
  const controller = new AbortController()
  const started = Promise.withResolvers<void>()

  // When
  const result = harness.withRun({ signal: controller.signal }, (run) =>
    run.withTurn((turn) =>
      turn.executeModel(
        ({ signal }) =>
          new Promise<ModelOutput>((_resolve, reject) => {
            started.resolve()
            signal.addEventListener("abort", () => reject(signal.reason), { once: true })
          }),
      ),
    ),
  )
  await started.promise
  controller.abort()

  let caught: unknown
  try {
    await result
  } catch (error) {
    if (error instanceof ExecutionHarnessError) {
      caught = error
    } else {
      throw error
    }
  }

  // Then
  expect(caught).toBeInstanceOf(ExecutionHarnessError)
  expect(caught).toMatchObject({ outcome: { type: "cancelled" } })
  expect(events.events.at(-1)?.type).toBe("run.cancelled")
})

test("blocks completion without retrying unchanged model input", async () => {
  // Given
  const { harness, events } = createHarnessFixture({
    completionGate: {
      evaluate: async () => ({ type: "blocked", reason: "verification is incomplete" }),
    },
  })
  let modelCallCount = 0

  // When
  let caught: unknown
  try {
    await harness.withRun({}, (run) =>
      run.withTurn(async (turn) => {
        const output = await turn.executeModel(async () => {
          modelCallCount += 1
          return { stopReason: "completed", content: "done", toolCalls: [] }
        })
        await turn.evaluateCompletion(output)
      }),
    )
  } catch (error) {
    if (error instanceof ExecutionHarnessError) {
      caught = error
    } else {
      throw error
    }
  }

  // Then
  expect(caught).toBeInstanceOf(ExecutionHarnessError)
  expect(caught).toMatchObject({
    outcome: { type: "blocked", reason: "verification is incomplete" },
  })
  expect(modelCallCount).toBe(1)
  expect(events.events.at(-1)?.type).toBe("run.blocked")
})

test("fails before a Tool effect when the awaited EventSink rejects", async () => {
  // Given
  let executionCount = 0
  let failedOnce = false
  const observedTypes: string[] = []
  const tool: Tool<EchoInput> = {
    ...echoTool,
    execute: async (input) => {
      executionCount += 1
      return { success: true, output: input.value }
    },
  }
  const { harness } = createHarnessFixture({
    tools: [tool],
    eventSink: {
      emit: async (event) => {
        observedTypes.push(event.type)
        if (event.type === "tool.started" && !failedOnce) {
          failedOnce = true
          throw new TestInvariantError("event sink failed")
        }
      },
    },
  })
  const output: ModelOutput = {
    stopReason: "tool_calls",
    toolCalls: [{ id: "sink_failure", name: "echo", arguments: { value: "value" } }],
  }

  // When
  let caught: unknown
  try {
    await harness.withRun({}, (run) =>
      run.withTurn(async (turn) => {
        await turn.executeModel(async () => output)
        return turn.executeTools(output.toolCalls)
      }),
    )
  } catch (error) {
    if (error instanceof ExecutionHarnessError) {
      caught = error
    } else {
      throw error
    }
  }

  // Then
  expect(caught).toMatchObject({ outcome: { type: "failed" } })
  expect(executionCount).toBe(0)
  expect(observedTypes.at(-1)).toBe("run.failed")
})

test("returns a typed failed outcome when the EventSink always rejects", async () => {
  // Given
  const observedTypes: string[] = []
  const { harness } = createHarnessFixture({
    eventSink: {
      emit: async (event) => {
        observedTypes.push(event.type)
        throw new TestInvariantError("event sink unavailable")
      },
    },
  })

  // When
  let caught: unknown
  try {
    await harness.withRun({}, async () => "unreachable")
  } catch (error) {
    if (error instanceof ExecutionEventSinkError) {
      caught = error
    } else {
      throw error
    }
  }

  // Then
  expect(caught).toMatchObject({ outcome: { type: "failed", reason: "EventSinkFailure" } })
  expect(observedTypes).toEqual(["run.started", "run.failed"])
})
