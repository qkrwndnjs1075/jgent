import { describe, expect, test } from "bun:test"
import {
  AjvToolValidator,
  InMemoryToolRegistry,
  type Tool,
  type ToolCall,
  ToolRuntime,
} from "../src/index.ts"

type EchoInput = {
  readonly value: string
}

const echoDefinition = {
  name: "echo",
  description: "Returns the supplied value",
  inputSchema: {
    type: "object",
    properties: {
      value: { type: "string" },
    },
    required: ["value"],
    additionalProperties: false,
  },
} satisfies Tool<EchoInput>["definition"]

function createEchoTool(execute: Tool<EchoInput>["execute"]): Tool<EchoInput> {
  return {
    definition: echoDefinition,
    capabilities: () => [],
    execute,
  }
}

function createRuntime(): {
  readonly registry: InMemoryToolRegistry
  readonly runtime: ToolRuntime
} {
  const registry = new InMemoryToolRegistry()
  return {
    registry,
    runtime: new ToolRuntime(registry, new AjvToolValidator()),
  }
}

describe("ToolRuntime", () => {
  test("returns a correlated result when registered tool execution succeeds", async () => {
    // Given
    const { registry, runtime } = createRuntime()
    registry.register(createEchoTool(async (input) => ({ success: true, output: input.value })))
    const call: ToolCall = {
      id: "call_success",
      name: "echo",
      arguments: { value: "hello" },
    }

    // When
    const result = await runtime.execute(call)

    // Then
    expect(result).toEqual({
      toolCallId: "call_success",
      success: true,
      output: "hello",
    })
  })

  test("does not invoke the tool when arguments fail schema validation", async () => {
    // Given
    const { registry, runtime } = createRuntime()
    let executionCount = 0
    registry.register(
      createEchoTool(async (input) => {
        executionCount += 1
        return { success: true, output: input.value }
      }),
    )

    // When
    const result = await runtime.execute({
      id: "call_invalid",
      name: "echo",
      arguments: { potato: 123 },
    })

    // Then
    expect(result).toEqual({
      toolCallId: "call_invalid",
      success: false,
      output: "",
      error: expect.stringContaining('Invalid arguments for tool "echo"'),
    })
    expect(executionCount).toBe(0)
  })

  test("returns a correlated failure when the requested tool is not registered", async () => {
    // Given
    const { runtime } = createRuntime()

    // When
    const result = await runtime.execute({
      id: "call_missing",
      name: "missing",
      arguments: {},
    })

    // Then
    expect(result).toEqual({
      toolCallId: "call_missing",
      success: false,
      output: "",
      error: "Unknown tool: missing",
    })
  })

  test("preserves an expected tool failure and adds the call id", async () => {
    // Given
    const { registry, runtime } = createRuntime()
    registry.register(
      createEchoTool(async () => ({
        success: false,
        output: "partial output",
        error: "expected failure",
      })),
    )

    // When
    const result = await runtime.execute({
      id: "call_failed",
      name: "echo",
      arguments: { value: "hello" },
    })

    // Then
    expect(result).toEqual({
      toolCallId: "call_failed",
      success: false,
      output: "partial output",
      error: "expected failure",
    })
  })

  test("returns a correlated failure when a tool implementation throws", async () => {
    // Given
    class UnexpectedToolError extends Error {
      readonly name = "UnexpectedToolError"
    }

    const { registry, runtime } = createRuntime()
    registry.register(
      createEchoTool(async () => {
        throw new UnexpectedToolError("unexpected failure")
      }),
    )

    // When
    const result = await runtime.execute({
      id: "call_exception",
      name: "echo",
      arguments: { value: "hello" },
    })

    // Then
    expect(result).toEqual({
      toolCallId: "call_exception",
      success: false,
      output: "",
      error: "unexpected failure",
    })
  })

  test("uses a stable fallback when a tool throws a non-Error value", async () => {
    // Given
    const nonErrorFailure: unknown = { reason: "unexpected failure" }
    const { registry, runtime } = createRuntime()
    registry.register(
      createEchoTool(async () => {
        throw nonErrorFailure
      }),
    )

    // When
    const result = await runtime.execute({
      id: "call_non_error_exception",
      name: "echo",
      arguments: { value: "hello" },
    })

    // Then
    expect(result).toEqual({
      toolCallId: "call_non_error_exception",
      success: false,
      output: "",
      error: "Unknown tool execution error",
    })
  })

  test("rejects duplicate tool names during registration", () => {
    // Given
    const { registry } = createRuntime()
    const tool = createEchoTool(async (input) => ({ success: true, output: input.value }))
    registry.register(tool)

    // When
    const registerDuplicate = () => registry.register(tool)

    // Then
    expect(registerDuplicate).toThrow('Tool "echo" is already registered')
  })
})
