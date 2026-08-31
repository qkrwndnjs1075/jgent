import { expect, test } from "bun:test"
import {
  ExecutionHarnessError,
  ExecutionInvariantError,
  type ModelOutput,
  type Tool,
  type TurnExecution,
} from "../../src/index.ts"
import { createHarnessFixture } from "./harness-test-fixtures.ts"

type EchoInput = {
  readonly value: string
}

const echoTool: Tool<EchoInput> = {
  definition: {
    name: "echo_invariant",
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

test("rejects a retained Turn handle after its scope closes", async () => {
  // Given
  const { harness } = createHarnessFixture()
  let retainedTurn: TurnExecution | undefined

  // When
  await harness.withRun({}, (run) =>
    run.withTurn(async (turn) => {
      retainedTurn = turn
    }),
  )

  // Then
  if (retainedTurn === undefined) {
    throw new Error("Expected the Turn handle to be retained")
  }
  await expect(
    retainedTurn.executeModel(async () => ({
      stopReason: "completed",
      content: "late",
      toolCalls: [],
    })),
  ).rejects.toBeInstanceOf(ExecutionInvariantError)
})

test("claims the single Model Item before concurrent attempts can start", async () => {
  // Given
  const { harness } = createHarnessFixture()
  const firstStarted = Promise.withResolvers<void>()
  const releaseFirst = Promise.withResolvers<void>()
  let secondCallbackCount = 0
  const output: ModelOutput = { stopReason: "completed", content: "done", toolCalls: [] }

  // When
  const execution = harness.withRun({}, (run) =>
    run.withTurn(async (turn) => {
      const first = turn.executeModel(async () => {
        firstStarted.resolve()
        await releaseFirst.promise
        return output
      })
      await firstStarted.promise
      const second = turn.executeModel(async () => {
        secondCallbackCount += 1
        return output
      })
      await expect(second).rejects.toBeInstanceOf(ExecutionInvariantError)
      releaseFirst.resolve()
      const firstOutput = await first
      await turn.evaluateCompletion(firstOutput)
    }),
  )
  await execution

  // Then
  expect(secondCallbackCount).toBe(0)
})

test("joins a fire-and-forget Tool before emitting Turn completion", async () => {
  // Given
  const toolStarted = Promise.withResolvers<void>()
  const releaseTool = Promise.withResolvers<void>()
  const tool: Tool<EchoInput> = {
    ...echoTool,
    execute: async (input) => {
      toolStarted.resolve()
      await releaseTool.promise
      return { success: true, output: input.value }
    },
  }
  const fixture = createHarnessFixture({ tools: [tool] })
  const output: ModelOutput = {
    stopReason: "tool_calls",
    toolCalls: [{ id: "fire_and_forget", name: "echo_invariant", arguments: { value: "value" } }],
  }

  // When
  const execution = fixture.harness.withRun({}, (run) =>
    run.withTurn(async (turn) => {
      await turn.executeModel(async () => output)
      turn.executeTools(output.toolCalls)
      await toolStarted.promise
    }),
  )
  await toolStarted.promise
  await Promise.resolve()

  // Then
  expect(fixture.events.events.some(({ type }) => type === "turn.completed")).toBe(false)
  releaseTool.resolve()
  await execution
  expect(fixture.events.events.at(-2)?.type).toBe("turn.completed")
})

test("does not change a latched completed outcome when terminal delivery fails", async () => {
  // Given
  const observedTypes: string[] = []
  const { harness } = createHarnessFixture({
    eventSink: {
      emit: async (event) => {
        observedTypes.push(event.type)
        if (event.type === "run.completed") {
          throw new Error("terminal delivery failed")
        }
      },
    },
  })

  // When
  let caught: unknown
  try {
    await harness.withRun({}, async () => "done")
  } catch (error) {
    caught = error
  }

  // Then
  expect(caught).toBeInstanceOf(ExecutionHarnessError)
  expect(caught).toMatchObject({
    outcome: { type: "completed" },
    failure: { kind: "event_sink" },
    terminalDelivery: { status: "failed", event: { type: "run.completed" } },
  })
  expect(observedTypes.filter((type) => type.startsWith("run.") && type !== "run.started")).toEqual(
    ["run.completed"],
  )
})
