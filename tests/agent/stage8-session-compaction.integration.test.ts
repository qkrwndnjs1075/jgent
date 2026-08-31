import { expect, test } from "bun:test"
import {
  AgentLoop,
  CompactionPolicy,
  Compactor,
  ContextAssembler,
  InMemorySessionStore,
  type ModelClient,
  type ModelContinuation,
  type ModelInput,
  type ModelOutput,
  type Tool,
} from "../../src/index.ts"
import { createHarnessFixture } from "../harness/harness-test-fixtures.ts"

test("resumes a loaded session without dropping the next user message", async () => {
  // Given
  const sessionStore = new InMemorySessionStore()
  const session = await sessionStore.create()
  const modelClient = new RecordingModelClient([
    completedOutput("first assistant response", continuation("response-1", 2)),
    completedOutput("second assistant response", continuation("response-2", 4)),
  ])
  const { harness } = createHarnessFixture()
  const loop = new AgentLoop(modelClient, harness, {
    contextAssembler: new ContextAssembler(),
    sessionStore,
  })

  // When
  await loop.run("first user request", { sessionId: session.id })
  const loadedSession = await sessionStore.load(session.id)
  if (loadedSession === null) {
    throw new Error("Expected the session to be loadable")
  }
  await loop.run("second user request", { sessionId: loadedSession.id })

  // Then
  const snapshot = await loadedSession.snapshot()
  expect(snapshot.messages).toEqual([
    { role: "user", content: "first user request" },
    { role: "assistant", content: "first assistant response" },
    { role: "user", content: "second user request" },
    { role: "assistant", content: "second assistant response" },
  ])
  expect(modelClient.inputs).toHaveLength(2)
  expect(modelClient.inputs[1]?.messages.at(-1)).toEqual({
    role: "user",
    content: "second user request",
  })
  expect(modelClient.inputs[1]?.continuation).toEqual(continuation("response-1", 2))
})

test("compacts into a summary view while retaining canonical messages", async () => {
  // Given
  const sessionStore = new InMemorySessionStore()
  const session = await sessionStore.create()
  const modelClient = new RecordingModelClient([
    completedOutput("first assistant response", continuation("response-1", 2)),
    completedOutput("second assistant response"),
  ])
  const { harness } = createHarnessFixture()
  const loop = new AgentLoop(modelClient, harness, {
    contextAssembler: new ContextAssembler(),
    sessionStore,
    compactionPolicy: new CompactionPolicy({ maxMessageCount: 2, recentMessageCount: 2 }),
    compactor: new Compactor({
      maxSummaryCharacters: 1_000,
    }),
  })

  // When
  await loop.run("first user request", { sessionId: session.id })
  await loop.run("second user request", { sessionId: session.id })

  // Then
  const compactedInput = modelClient.inputs[1]
  if (compactedInput === undefined) {
    throw new Error("Expected a model input after compaction")
  }
  expect(compactedInput.continuation).toBeUndefined()
  const summaryMessage = compactedInput.messages[0]
  if (summaryMessage?.role !== "system") {
    throw new Error("Expected a system summary in the compacted model input")
  }
  expect(summaryMessage.content).not.toBe("")
  expect(compactedInput.messages.slice(-2)).toEqual([
    { role: "assistant", content: "first assistant response" },
    { role: "user", content: "second user request" },
  ])

  const snapshot = await session.snapshot()
  expect(snapshot.messages).toEqual([
    { role: "user", content: "first user request" },
    { role: "assistant", content: "first assistant response" },
    { role: "user", content: "second user request" },
    { role: "assistant", content: "second assistant response" },
  ])
})

test("persists a complete Tool round before the next model turn", async () => {
  // Given
  const echoDefinition = {
    name: "echo",
    description: "Returns the supplied value",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
  } satisfies Tool<{ readonly value: string }>["definition"]
  const echoTool: Tool<{ readonly value: string }> = {
    definition: echoDefinition,
    capabilities: () => [],
    execute: async (input) => ({ success: true, output: input.value }),
  }
  const sessionStore = new InMemorySessionStore()
  const session = await sessionStore.create()
  const modelClient = new RecordingModelClient([
    {
      stopReason: "tool_calls",
      toolCalls: [{ id: "call-echo", name: "echo", arguments: { value: "TOOL_OUTPUT" } }],
      continuation: continuation("response-1", 2),
    },
    completedOutput("FINAL_OUTPUT", continuation("response-2", 4)),
  ])
  const { harness } = createHarnessFixture({ tools: [echoTool] })
  const loop = new AgentLoop(modelClient, harness, {
    contextAssembler: new ContextAssembler(),
    sessionStore,
  })

  // When
  await loop.run("tool request", { sessionId: session.id })

  // Then
  const snapshot = await session.snapshot()
  expect(snapshot.messages).toEqual([
    { role: "user", content: "tool request" },
    {
      role: "assistant",
      toolCalls: [{ id: "call-echo", name: "echo", arguments: { value: "TOOL_OUTPUT" } }],
    },
    {
      role: "tool",
      result: { toolCallId: "call-echo", success: true, output: "TOOL_OUTPUT" },
    },
    { role: "assistant", content: "FINAL_OUTPUT" },
  ])
  expect(modelClient.inputs[1]?.continuation).toEqual(continuation("response-1", 2))
  expect(modelClient.inputs[1]?.messages).toEqual([
    { role: "user", content: "tool request" },
    {
      role: "assistant",
      toolCalls: [{ id: "call-echo", name: "echo", arguments: { value: "TOOL_OUTPUT" } }],
    },
    {
      role: "tool",
      result: { toolCallId: "call-echo", success: true, output: "TOOL_OUTPUT" },
    },
  ])
})

class RecordingModelClient implements ModelClient {
  readonly inputs: ModelInput[] = []
  #nextOutput = 0

  constructor(private readonly outputs: readonly ModelOutput[]) {}

  async generate(input: ModelInput): Promise<ModelOutput> {
    const output = this.outputs[this.#nextOutput]
    if (output === undefined) {
      throw new Error("Unexpected model call")
    }
    this.#nextOutput += 1
    this.inputs.push({
      messages: input.messages.slice(),
      tools: input.tools,
      ...(input.continuation === undefined ? {} : { continuation: input.continuation }),
    })
    return output
  }
}

function continuation(state: string, consumedMessageCount: number): ModelContinuation {
  return { provider: "fake", state, consumedMessageCount }
}

function completedOutput(content: string, continuationValue?: ModelContinuation): ModelOutput {
  return continuationValue === undefined
    ? {
        stopReason: "completed",
        content,
        toolCalls: [],
      }
    : {
        stopReason: "completed",
        content,
        toolCalls: [],
        continuation: continuationValue,
      }
}
