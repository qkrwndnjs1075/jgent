import { expect, test } from "bun:test"
import type { Tool } from "../../src/index.ts"
import { createHarnessFixture, TestInvariantError } from "./harness-test-fixtures.ts"

type EmptyInput = Record<string, never>

const visibleTool: Tool<EmptyInput> = {
  definition: {
    name: "visible",
    description: "Visible Tool",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  capabilities: () => [],
  execute: async () => ({ success: true, output: "visible" }),
}

test("snapshots exposed Tool definitions once per Run", async () => {
  // Given
  let exposeTools = true
  let filterCount = 0
  const { harness } = createHarnessFixture({
    tools: [visibleTool],
    exposurePolicy: {
      filter: (tools) => {
        filterCount += 1
        return exposeTools ? tools : []
      },
    },
  })

  // When
  const firstRunTools = await harness.withRun({}, async (run) => {
    const firstTurn = run.exposedTools.map(({ name }) => name)
    exposeTools = false
    await run.withTurn(async () => {})
    const secondTurn = run.exposedTools.map(({ name }) => name)
    return [firstTurn, secondTurn]
  })
  const secondRunTools = await harness.withRun({}, async (run) =>
    run.exposedTools.map(({ name }) => name),
  )

  // Then
  expect(firstRunTools).toEqual([["visible"], ["visible"]])
  expect(secondRunTools).toEqual([])
  expect(filterCount).toBe(2)
})

test("deep-freezes exposed Tool definitions for the entire Run", async () => {
  // Given
  const { harness } = createHarnessFixture({ tools: [visibleTool] })

  // When
  const observation = await harness.withRun({}, async (run) => {
    const definition = run.exposedTools[0]
    if (definition === undefined) {
      throw new TestInvariantError("Expected an exposed Tool")
    }
    const descriptionChanged = Reflect.set(definition, "description", "mutated")
    const schemaChanged = Reflect.set(definition.inputSchema, "additionalProperties", true)
    await run.withTurn(async () => {})
    return {
      descriptionChanged,
      schemaChanged,
      description: definition.description,
      additionalProperties: Reflect.get(definition.inputSchema, "additionalProperties"),
    }
  })

  // Then
  expect(observation).toEqual({
    descriptionChanged: false,
    schemaChanged: false,
    description: "Visible Tool",
    additionalProperties: false,
  })
})
