import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { AgentRunCoordinator } from "../../src/agent/agent-run-coordinator.ts"
import {
  AgentLoop,
  CompactionPolicy,
  Compactor,
  ContextAssembler,
  createInstructionProfile,
  ExecutionFailedError,
  InMemorySessionStore,
  instructionProfileFingerprint,
  type ModelClient,
  type ModelContinuation,
  type ModelInput,
  type ModelOutput,
  type Tool,
} from "../../src/index.ts"
import { createHarnessFixture } from "../harness/harness-test-fixtures.ts"

test("keeps the public AgentLoop facade within the 160 pure-LOC budget", async () => {
  // Given
  const sourcePath = join(import.meta.dir, "../../src/agent/agent-loop.ts")

  // When
  const source = await readFile(sourcePath, "utf8")

  // Then
  expect(pureLineCount(source)).toBeLessThanOrEqual(160)
})

test("returns an immutable completed run after checkpointing the user and assistant messages", async () => {
  // Given
  const sessionStore = new InMemorySessionStore()
  const session = await sessionStore.create()
  const modelClient = new CompletedModelClient("COORDINATED_OUTPUT")
  const { harness } = createHarnessFixture()
  const coordinator = new AgentRunCoordinator({
    modelClient,
    harness,
    contextAssembler: new ContextAssembler(),
  })

  // When
  const result = await coordinator.run({
    session,
    userInput: "coordinate this run",
    options: {},
    instructionProfile: createInstructionProfile({}),
  })

  // Then
  expect(result.content).toBe("COORDINATED_OUTPUT")
  expect(result.initialMessageCount).toBe(0)
  expect(result.finalSnapshot.messages).toEqual([
    { role: "user", content: "coordinate this run" },
    { role: "assistant", content: "COORDINATED_OUTPUT" },
  ])
  expect(Object.isFrozen(result)).toBe(true)
})

test("checkpoints the assistant tool call before its tool result and resumes with continuation", async () => {
  // Given
  const echoTool = createEchoTool()
  const sessionStore = new InMemorySessionStore()
  const session = await sessionStore.create()
  const firstContinuation = continuation("response-1", 2)
  const modelClient = new RecordingModelClient([
    {
      stopReason: "tool_calls",
      toolCalls: [{ id: "call-echo", name: "echo", arguments: { value: "TOOL_OUTPUT" } }],
      continuation: firstContinuation,
    },
    { stopReason: "completed", content: "TOOL_COMPLETE", toolCalls: [] },
  ])
  const { harness } = createHarnessFixture({ tools: [echoTool] })
  const coordinator = new AgentRunCoordinator({
    modelClient,
    harness,
    contextAssembler: new ContextAssembler(),
  })

  // When
  const result = await coordinator.run({
    session,
    userInput: "run the echo tool",
    options: {},
    instructionProfile: createInstructionProfile({}),
  })

  // Then
  expect(result.content).toBe("TOOL_COMPLETE")
  expect(result.finalSnapshot.messages).toEqual([
    { role: "user", content: "run the echo tool" },
    {
      role: "assistant",
      toolCalls: [{ id: "call-echo", name: "echo", arguments: { value: "TOOL_OUTPUT" } }],
    },
    { role: "tool", result: { toolCallId: "call-echo", success: true, output: "TOOL_OUTPUT" } },
    { role: "assistant", content: "TOOL_COMPLETE" },
  ])
  expect(modelClient.inputs[1]?.continuation).toEqual(firstContinuation)
})

test("compacts canonical history before assembling the model context", async () => {
  // Given
  const sessionStore = new InMemorySessionStore()
  const session = await sessionStore.create()
  await session.checkpoint({
    expectedRevision: (await session.snapshot()).revision,
    append: [
      { role: "user", content: "earlier request" },
      { role: "assistant", content: "earlier response" },
    ],
  })
  const modelClient = new RecordingModelClient([
    { stopReason: "completed", content: "COMPACTED_OUTPUT", toolCalls: [] },
  ])
  const { harness } = createHarnessFixture()
  const coordinator = new AgentRunCoordinator({
    modelClient,
    harness,
    contextAssembler: new ContextAssembler(),
    compactionPolicy: new CompactionPolicy({ maxMessageCount: 1, recentMessageCount: 2 }),
    compactor: new Compactor({ maxSummaryCharacters: 1_000 }),
  })

  // When
  const result = await coordinator.run({
    session,
    userInput: "current request",
    options: {},
    instructionProfile: createInstructionProfile({}),
  })

  // Then
  expect(result.finalSnapshot.compaction?.coveredMessageCount).toBe(1)
  expect(modelClient.inputs[0]?.messages.map(({ role }) => role)).toEqual([
    "system",
    "assistant",
    "user",
  ])
  expect(result.finalSnapshot.messages).toEqual([
    { role: "user", content: "earlier request" },
    { role: "assistant", content: "earlier response" },
    { role: "user", content: "current request" },
    { role: "assistant", content: "COMPACTED_OUTPUT" },
  ])
})

test("clears a mismatched instruction continuation before the model call", async () => {
  // Given
  const sessionStore = new InMemorySessionStore()
  const session = await sessionStore.create()
  const previousProfile = createInstructionProfile({ systemInstructions: "previous profile" })
  const previousFingerprint = instructionProfileFingerprint(previousProfile)
  if (previousFingerprint === undefined) {
    throw new TestInvariantError("Expected an instruction fingerprint")
  }
  await session.checkpoint({
    expectedRevision: (await session.snapshot()).revision,
    append: [
      { role: "user", content: "earlier request" },
      { role: "assistant", content: "earlier response" },
    ],
    continuation: {
      type: "replace",
      continuation: continuation("response-previous", 2),
      instructionFingerprint: previousFingerprint,
    },
  })
  const modelClient = new RecordingModelClient([
    { stopReason: "completed", content: "PROFILE_OUTPUT", toolCalls: [] },
  ])
  const { harness } = createHarnessFixture()
  const coordinator = new AgentRunCoordinator({
    modelClient,
    harness,
    contextAssembler: new ContextAssembler(),
  })

  // When
  await coordinator.run({
    session,
    userInput: "current request",
    options: {},
    instructionProfile: createInstructionProfile({ systemInstructions: "current profile" }),
  })

  // Then
  expect(modelClient.inputs[0]?.continuation).toBeUndefined()
  expect((await session.snapshot()).continuation).toBeUndefined()
})

test("releases the Session lock after a model failure without a final assistant checkpoint", async () => {
  // Given
  const sessionStore = new InMemorySessionStore()
  const session = await sessionStore.create()
  const modelClient = new SequencedModelClient([
    new TestModelError(),
    { stopReason: "completed", content: "RECOVERED_OUTPUT", toolCalls: [] },
  ])
  const { harness } = createHarnessFixture()
  const loop = new AgentLoop(modelClient, harness, {
    contextAssembler: new ContextAssembler(),
    sessionStore,
  })

  // When
  const failedRun = loop.run("first request", { sessionId: session.id })
  await expect(failedRun).rejects.toBeInstanceOf(ExecutionFailedError)
  const recoveredOutput = await loop.run("second request", { sessionId: session.id })

  // Then
  expect(recoveredOutput).toBe("RECOVERED_OUTPUT")
  expect((await session.snapshot()).messages).toEqual([
    { role: "user", content: "first request" },
    { role: "user", content: "second request" },
    { role: "assistant", content: "RECOVERED_OUTPUT" },
  ])
})

class CompletedModelClient implements ModelClient {
  constructor(private readonly content: string) {}

  async generate(_input: ModelInput): Promise<ModelOutput> {
    return { stopReason: "completed", content: this.content, toolCalls: [] }
  }
}

type ModelResult = ModelOutput | TestModelError

class RecordingModelClient implements ModelClient {
  readonly inputs: ModelInput[] = []
  #nextResult = 0

  constructor(private readonly results: readonly ModelResult[]) {}

  async generate(input: ModelInput): Promise<ModelOutput> {
    const result = this.results[this.#nextResult]
    if (result === undefined) {
      throw new UnexpectedModelCallError()
    }
    this.#nextResult += 1
    this.inputs.push({
      messages: input.messages.slice(),
      tools: input.tools,
      ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
      ...(input.continuation === undefined ? {} : { continuation: input.continuation }),
    })
    if (result instanceof TestModelError) {
      throw result
    }
    return result
  }
}

class SequencedModelClient implements ModelClient {
  #nextResult = 0

  constructor(private readonly results: readonly ModelResult[]) {}

  async generate(_input: ModelInput): Promise<ModelOutput> {
    const result = this.results[this.#nextResult]
    if (result === undefined) {
      throw new UnexpectedModelCallError()
    }
    this.#nextResult += 1
    if (result instanceof TestModelError) {
      throw result
    }
    return result
  }
}

class TestModelError extends Error {
  readonly name = "TestModelError"
}

class UnexpectedModelCallError extends Error {
  readonly name = "UnexpectedModelCallError"
}

class TestInvariantError extends Error {
  readonly name = "TestInvariantError"
}

function createEchoTool(): Tool<{ readonly value: string }> {
  return {
    definition: {
      name: "echo",
      description: "Returns the supplied value",
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
}

function continuation(state: string, consumedMessageCount: number): ModelContinuation {
  return { provider: "fake", state, consumedMessageCount }
}

function pureLineCount(source: string): number {
  return source.split("\n").filter((line) => {
    const trimmed = line.trim()
    return trimmed.length > 0 && !trimmed.startsWith("//")
  }).length
}
