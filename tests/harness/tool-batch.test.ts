import { expect, test } from "bun:test"
import { ExecutionHarnessError, type Tool } from "../../src/index.ts"
import { createHarnessFixture } from "./harness-test-fixtures.ts"

type BatchInput = {
  readonly label: string
}

test("executes Tool calls sequentially and preserves result order", async () => {
  // Given
  const releaseFirst = Promise.withResolvers<void>()
  const firstStarted = Promise.withResolvers<void>()
  const observations: string[] = []
  const tool: Tool<BatchInput> = {
    definition: {
      name: "batch",
      description: "Observes execution order",
      inputSchema: {
        type: "object",
        properties: { label: { type: "string" } },
        required: ["label"],
        additionalProperties: false,
      },
    },
    capabilities: () => [],
    execute: async (input) => {
      observations.push(`${input.label}.started`)
      if (input.label === "A") {
        firstStarted.resolve()
        await releaseFirst.promise
      }
      observations.push(`${input.label}.completed`)
      return { success: true, output: input.label }
    },
  }
  const { harness } = createHarnessFixture({ tools: [tool] })

  // When
  const execution = harness.withRun({}, (run) =>
    run.withTurn(async (turn) => {
      const output = await turn.executeModel(async () => ({
        stopReason: "tool_calls",
        toolCalls: [
          { id: "call_a", name: "batch", arguments: { label: "A" } },
          { id: "call_b", name: "batch", arguments: { label: "B" } },
        ],
      }))
      return turn.executeTools(output.toolCalls)
    }),
  )
  await firstStarted.promise
  expect(observations).toEqual(["A.started"])
  releaseFirst.resolve()
  const results = await execution

  // Then
  expect(observations).toEqual(["A.started", "A.completed", "B.started", "B.completed"])
  expect(results.map(({ toolCallId }) => toolCallId)).toEqual(["call_a", "call_b"])
})

test("rejects duplicate provider Tool-call IDs before effects", async () => {
  // Given
  let executionCount = 0
  const tool: Tool<BatchInput> = {
    definition: {
      name: "batch",
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
  const { harness } = createHarnessFixture({ tools: [tool] })

  // When
  let caught: unknown
  try {
    await harness.withRun({}, (run) =>
      run.withTurn(async (turn) => {
        const output = await turn.executeModel(async () => ({
          stopReason: "tool_calls",
          toolCalls: [
            { id: "duplicate", name: "batch", arguments: { label: "A" } },
            { id: "duplicate", name: "batch", arguments: { label: "B" } },
          ],
        }))
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
})
