import { expect, test } from "bun:test"
import {
  AjvToolValidator,
  InMemoryToolRegistry,
  type Tool,
  type ToolCall,
  ToolRuntime,
} from "../../src/index.ts"

type PathInput = {
  readonly path: string
}

const pathDefinition = {
  name: "prepared_path",
  description: "Prepares a path",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false,
  },
} satisfies Tool<PathInput>["definition"]

function _createRuntime(): ToolRuntime {
  return new ToolRuntime(new InMemoryToolRegistry(), new AjvToolValidator())
}

function pathCall(id: string, path: string): ToolCall {
  return { id, name: "prepared_path", arguments: { path } }
}

function createPathTool(
  execute: Tool<PathInput>["execute"] = async (input) => ({
    success: true,
    output: input.path,
  }),
  capabilities: Tool<PathInput>["capabilities"] = (input) => [
    { type: "filesystem.read", path: input.path },
  ],
): Tool<PathInput> {
  return { definition: pathDefinition, capabilities, execute }
}

test("deep-freezes the canonical input and capabilities before authorization", () => {
  // Given
  const registry = new InMemoryToolRegistry()
  const runtime = new ToolRuntime(registry, new AjvToolValidator())
  registry.register(createPathTool())

  // When
  const preparation = runtime.prepare(pathCall("freeze", "/tmp/before"))

  // Then
  expect(preparation.valid).toBe(true)
  if (!preparation.valid) {
    return
  }
  expect(Object.isFrozen(preparation.prepared)).toBe(true)
  expect(Object.isFrozen(preparation.prepared.input)).toBe(true)
  expect(Object.isFrozen(preparation.prepared.capabilities)).toBe(true)
  const capability = preparation.prepared.capabilities[0]
  if (capability === undefined) {
    throw new Error("Expected a prepared capability")
  }
  expect(Object.isFrozen(capability)).toBe(true)
  expect(Reflect.set(preparation.prepared.input, "path", "/tmp/after")).toBe(false)
  expect(Reflect.set(capability, "path", "/tmp/after")).toBe(false)
})

test("captures the executor at registration time", async () => {
  // Given
  const registry = new InMemoryToolRegistry()
  const runtime = new ToolRuntime(registry, new AjvToolValidator())
  const tool = createPathTool(
    async () => ({ success: true as const, output: "original" }),
    () => [],
  )
  registry.register(tool)
  const preparation = runtime.prepare(pathCall("capture", "/tmp/path"))
  if (!preparation.valid) {
    throw new Error("Expected a valid prepared Tool")
  }
  Reflect.set(tool, "execute", async () => ({ success: true as const, output: "swapped" }))

  // When
  const result = await runtime.executePrepared(preparation.prepared, {
    signal: new AbortController().signal,
  })

  // Then
  expect(result).toMatchObject({ toolCallId: "capture", success: true, output: "original" })
})

test("binds equivalent canonical effects to the same digest", () => {
  // Given
  const registry = new InMemoryToolRegistry()
  const runtime = new ToolRuntime(registry, new AjvToolValidator())
  registry.register(createPathTool())

  // When
  const first = runtime.prepare(pathCall("first", "/tmp/equivalent"))
  const second = runtime.prepare(pathCall("second", "/tmp/equivalent"))

  // Then
  expect(first.valid).toBe(true)
  expect(second.valid).toBe(true)
  if (!first.valid || !second.valid) {
    return
  }
  expect(first.prepared.effectDigest).toMatch(/^[a-f0-9]{64}$/)
  expect(first.prepared.effectDigest).toBe(second.prepared.effectDigest)
  expect(first.prepared.effectDigest).not.toBe(first.prepared.callId)
})

test("keeps thrown failure metadata internal to provider Tool output", async () => {
  // Given
  class ToolFailure extends Error {
    readonly name = "ToolFailure"
  }
  const registry = new InMemoryToolRegistry()
  const runtime = new ToolRuntime(registry, new AjvToolValidator())
  registry.register(
    createPathTool(
      async () => {
        throw new ToolFailure("effect failed")
      },
      () => [],
    ),
  )

  // When
  const result = await runtime.execute(pathCall("typed", "/tmp/path"))

  // Then
  expect(result.failure).toEqual({ kind: "thrown", name: "ToolFailure", message: "effect failed" })
  expect(JSON.stringify(result)).not.toContain("ToolFailure")
})

test("runs the optional transform before validation and preparation", async () => {
  // Given
  const registry = new InMemoryToolRegistry()
  registry.register(
    createPathTool(
      async (input) => ({ success: true, output: input.path }),
      () => [],
    ),
  )
  const runtime = new ToolRuntime(registry, new AjvToolValidator(), {
    transform: (call) => ({
      ...call,
      arguments: { path: "/tmp/canonical" },
    }),
  })

  // When
  const result = await runtime.execute(pathCall("transformed", "raw"))

  // Then
  expect(result).toMatchObject({ success: true, output: "/tmp/canonical" })
})
