import { expect, test } from "bun:test"
import type { AgentMessage, ModelContinuation, ToolDefinition } from "../../src/index.ts"
import {
  ContextAssembler,
  ContextViewIdSchema,
  createInstructionProfile,
  createSkill,
  createSkillInstructionProfile,
  fingerprintSkills,
  InMemoryAgentSession,
  type MemoryProjection,
  MemoryRecordSchema,
  SessionIdSchema,
  WorkspaceIdSchema,
} from "../../src/index.ts"

const toolDefinition: ToolDefinition = {
  name: "test_tool",
  description: "",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
}
const memoryRecord = MemoryRecordSchema.parse({
  id: "018f72d0-4e88-7e3f-a737-4e8b03724a0e",
  deduplicationKey: "a".repeat(64),
  fingerprint: "f".repeat(64),
  kind: "project",
  content: "Use focused tests.",
  tags: ["testing"],
  scope: { type: "workspace", workspaceId: WorkspaceIdSchema.parse("workspace-1") },
  source: {
    sessionId: SessionIdSchema.parse("018f72d0-4e88-7e3f-a737-4e8b03724a0f"),
    sourceRevision: 1,
    messageRange: { start: 0, end: 1 },
  },
  createdAt: 1,
})

test("assembles messages and tools without adding an absent continuation", async () => {
  // Given
  const messages: readonly AgentMessage[] = Object.freeze([{ role: "user", content: "USER_INPUT" }])
  const tools: readonly ToolDefinition[] = Object.freeze([toolDefinition])
  const assembler = new ContextAssembler()

  // When
  const result = await assembler.build(Object.freeze({ messages, tools }))

  // Then
  expect(result).toEqual({ messages, tools })
})

test("passes opaque continuation state through unchanged", async () => {
  // Given
  const messages: readonly AgentMessage[] = Object.freeze([{ role: "user", content: "USER_INPUT" }])
  const continuation: ModelContinuation = Object.freeze({
    provider: "test-provider",
    state: "test-state",
    consumedMessageCount: 1,
  })
  const tools = Object.freeze([toolDefinition])
  const assembler = new ContextAssembler()

  // When
  const result = await assembler.build(Object.freeze({ messages, tools, continuation }))

  // Then
  expect(result.continuation).toBe(continuation)
})

test("assembles one request-level instruction profile outside messages", async () => {
  // Given
  const messages: readonly AgentMessage[] = Object.freeze([{ role: "user", content: "USER_INPUT" }])
  const tools: readonly ToolDefinition[] = Object.freeze([toolDefinition])
  const assembler = new ContextAssembler()

  // When
  const result = await assembler.build(
    Object.freeze({
      messages,
      tools,
      instructionProfile: {
        type: "instructions" as const,
        instructions: "<skills></skills>",
        fingerprint: "PROFILE_A",
      },
    }),
  )

  // Then
  expect(result.instructions).toBe("<skills></skills>")
  expect(result.messages).toBe(messages)
})

test("drops continuation bound to a different instruction profile", async () => {
  // Given
  const assembler = new ContextAssembler()
  const contextViewId = ContextViewIdSchema.parse("context-view")
  const continuation: ModelContinuation = {
    provider: "test-provider",
    state: "test-state",
    consumedMessageCount: 1,
  }

  // When
  const result = await assembler.buildView({
    messages: [{ role: "user", content: "USER_INPUT" }],
    tools: [],
    contextViewId,
    instructionProfile: {
      type: "instructions",
      instructions: "<skills></skills>",
      fingerprint: "PROFILE_NEW",
    },
    continuation: {
      value: continuation,
      contextViewId,
      instructionFingerprint: "PROFILE_OLD",
    },
  })

  // Then
  expect(result.input.continuation).toBeUndefined()
  expect(result.instructionFingerprint).toBe("PROFILE_NEW")
})

test("renders one transient Memory data block before canonical messages", async () => {
  // Given
  const session = new InMemoryAgentSession(
    SessionIdSchema.parse("018f72d0-4e88-7e3f-a737-4e8b03724a0e"),
  )
  const snapshot = await session.checkpoint({
    expectedRevision: (await session.snapshot()).revision,
    append: [{ role: "user", content: "USER_INPUT" }],
  })
  const memoryBlock = '<memory_data>\n{"records":[]}\n</memory_data>'
  const memoryProjection: MemoryProjection = {
    records: [memoryRecord],
    renderedDataBlock: memoryBlock,
    fingerprint: "a".repeat(64),
  }
  const assembler = new ContextAssembler()

  // When
  const result = await assembler.buildSession({
    snapshot,
    tools: [],
    memoryProjection,
  })

  // Then
  expect(result.input.messages).toEqual([
    { role: "system", content: memoryBlock },
    { role: "user", content: "USER_INPUT" },
  ])
  expect(result.memoryFingerprint).toBe(memoryProjection.fingerprint)
})

test("drops continuation when the Memory projection fingerprint changes", async () => {
  // Given
  const assembler = new ContextAssembler()
  const contextViewId = ContextViewIdSchema.parse("context-view-memory")
  const continuation: ModelContinuation = {
    provider: "test-provider",
    state: "test-state",
    consumedMessageCount: 2,
  }
  const memoryProjection: MemoryProjection = {
    records: [memoryRecord],
    renderedDataBlock: '<memory_data>\n{"records":[]}\n</memory_data>',
    fingerprint: "b".repeat(64),
  }

  // When
  const result = await assembler.buildView({
    messages: [{ role: "user", content: "USER_INPUT" }],
    tools: [],
    contextViewId,
    memoryProjection,
    continuation: {
      value: continuation,
      contextViewId,
      memoryFingerprint: "c".repeat(64),
    },
  })

  // Then
  expect(result.input.continuation).toBeUndefined()
  expect(result.memoryFingerprint).toBe(memoryProjection.fingerprint)
})

test("creates one deterministic instruction profile from resolved skills", () => {
  // Given
  const skill = createSkill({
    id: "testing",
    name: "Testing",
    description: "Runs focused tests",
    instructions: "Run the focused test suite.",
    sourcePath: "/repo/.my-agent/skills/testing/SKILL.md",
  })
  const resolution = Object.freeze({
    skills: Object.freeze([skill]),
    fingerprint: fingerprintSkills([skill]),
  })

  // When
  const first = createSkillInstructionProfile(resolution)
  const second = createSkillInstructionProfile(resolution)

  // Then
  expect(first).toEqual(second)
  expect(first.type).toBe("instructions")
  if (first.type === "instructions") {
    expect(first.instructions.match(/<instructions>/g)).toHaveLength(1)
    expect(first.instructions.match(/<\/instructions>/g)).toHaveLength(1)
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  }
  expect(Object.isFrozen(first)).toBe(true)
})

test("orders system, project, and Skill instruction layers in one fingerprinted profile", () => {
  // Given
  const skill = createSkill({
    id: "testing",
    name: "Testing",
    description: "Runs focused tests",
    instructions: "Run the focused test suite.",
    sourcePath: "/repo/.my-agent/skills/testing/SKILL.md",
  })
  const skillResolution = Object.freeze({
    skills: Object.freeze([skill]),
    fingerprint: fingerprintSkills([skill]),
  })

  // When
  const profile = createInstructionProfile({
    systemInstructions: "SYSTEM_RULE",
    projectInstructions: "PROJECT_RULE",
    skillResolution,
  })
  const changedProject = createInstructionProfile({
    systemInstructions: "SYSTEM_RULE",
    projectInstructions: "CHANGED_PROJECT_RULE",
    skillResolution,
  })

  // Then
  if (profile.type !== "instructions" || changedProject.type !== "instructions") {
    throw new TestInvariantError("Expected instruction profiles")
  }
  const systemIndex = profile.instructions.indexOf('"kind":"system"')
  const projectIndex = profile.instructions.indexOf('"kind":"project"')
  const skillIndex = profile.instructions.indexOf('"kind":"skill"')
  expect(systemIndex).toBeGreaterThan(-1)
  expect(projectIndex).toBeGreaterThan(systemIndex)
  expect(skillIndex).toBeGreaterThan(projectIndex)
  expect(profile.instructions.match(/<instructions>/g)).toHaveLength(1)
  expect(profile.fingerprint).not.toBe(changedProject.fingerprint)
})

class TestInvariantError extends Error {
  readonly name = "TestInvariantError"
}
