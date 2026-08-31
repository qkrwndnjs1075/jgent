import { expect, test } from "bun:test"
import { CompactionPolicy, Compactor } from "../../src/compaction/index.ts"
import type { AgentMessage } from "../../src/core/index.ts"
import {
  type CompactionCheckpoint,
  ContextViewIdSchema,
  SessionIdSchema,
  SessionRevisionSchema,
  type SessionSnapshot,
} from "../../src/session/index.ts"

const userMessage: AgentMessage = { role: "user", content: "user-request" }
const assistantMessage: AgentMessage = { role: "assistant", content: "assistant-response" }
const toolRound: readonly AgentMessage[] = [
  {
    role: "assistant",
    toolCalls: [
      { id: "call-read", name: "read_file", arguments: {} },
      { id: "call-list", name: "list_directory", arguments: {} },
    ],
  },
  { role: "tool", result: { toolCallId: "call-read", success: true, output: "read-result" } },
  { role: "tool", result: { toolCallId: "call-list", success: true, output: "list-result" } },
]

test("keeps a session below the compaction threshold", () => {
  // Given
  const policy = new CompactionPolicy({ maxMessageCount: 3, recentMessageCount: 2 })
  const snapshot = createSnapshot([userMessage, assistantMessage, userMessage])

  // When
  const decision = policy.decide(snapshot)

  // Then
  expect(decision).toEqual({ type: "keep" })
})

test("keeps the complete assistant tool-call round in the recent history", () => {
  // Given
  const policy = new CompactionPolicy({ maxMessageCount: 3, recentMessageCount: 3 })
  const snapshot = createSnapshot([userMessage, ...toolRound, userMessage, assistantMessage])

  // When
  const decision = policy.decide(snapshot)

  // Then
  expect(decision).toEqual({ type: "compact", coveredMessageCount: 1 })
})

test("uses the first boundary after all correlated tool results", () => {
  // Given
  const policy = new CompactionPolicy({ maxMessageCount: 1, recentMessageCount: 2 })
  const snapshot = createSnapshot([userMessage, ...toolRound, userMessage, assistantMessage])

  // When
  const decision = policy.decide(snapshot)

  // Then
  expect(decision).toEqual({ type: "compact", coveredMessageCount: 4 })
})

test("does not extend a checkpoint when the only candidate would start on a tool result", () => {
  // Given
  const policy = new CompactionPolicy({ maxMessageCount: 1, recentMessageCount: 1 })
  const checkpoint: CompactionCheckpoint = {
    summary: "existing-checkpoint",
    coveredMessageCount: 1,
    sourceRevision: SessionRevisionSchema.parse(1),
  }
  const snapshot = createSnapshot([userMessage, ...toolRound], checkpoint)

  // When
  const decision = policy.decide(snapshot)

  // Then
  expect(decision).toEqual({ type: "keep" })
})

test("does not compact an incomplete tool round in the retained tail", () => {
  // Given
  const policy = new CompactionPolicy({ maxMessageCount: 1, recentMessageCount: 1 })
  const incompleteToolRound: readonly AgentMessage[] = [
    userMessage,
    {
      role: "assistant",
      toolCalls: [
        { id: "call-read", name: "read_file", arguments: {} },
        { id: "call-list", name: "list_directory", arguments: {} },
      ],
    },
    { role: "tool", result: { toolCallId: "call-read", success: true, output: "read-result" } },
  ]
  const snapshot = createSnapshot(incompleteToolRound)

  // When
  const decision = policy.decide(snapshot)

  // Then
  expect(decision).toEqual({ type: "keep" })
})

test("creates a bounded checkpoint from canonical messages without mutating them", () => {
  // Given
  const checkpoint: CompactionCheckpoint = {
    summary: "existing-checkpoint",
    coveredMessageCount: 1,
    sourceRevision: SessionRevisionSchema.parse(1),
  }
  const snapshot = createSnapshot(
    [userMessage, assistantMessage, { role: "user", content: "x".repeat(120) }],
    checkpoint,
  )
  const canonicalMessages = structuredClone(snapshot.messages)
  const compactor = new Compactor({ maxSummaryCharacters: 48 })

  // When
  const result = compactor.compact({ snapshot, coveredMessageCount: 3 })

  // Then
  expect(result.coveredMessageCount).toBe(3)
  expect(result.sourceRevision).toBe(snapshot.revision)
  expect(result.summary.length).toBeLessThanOrEqual(48)
  expect(snapshot.messages).toEqual(canonicalMessages)
})

test("builds the same bounded summary for the same checkpoint input", () => {
  // Given
  const snapshot = createSnapshot([userMessage, assistantMessage])
  const compactor = new Compactor({ maxSummaryCharacters: 48 })

  // When
  const first = compactor.compact({ snapshot, coveredMessageCount: 2 })
  const second = compactor.compact({ snapshot, coveredMessageCount: 2 })

  // Then
  expect(second).toEqual(first)
})

function createSnapshot(
  messages: readonly AgentMessage[],
  compaction?: CompactionCheckpoint,
): SessionSnapshot {
  return {
    id: SessionIdSchema.parse("session-test"),
    revision: SessionRevisionSchema.parse(3),
    messages,
    contextViewId: ContextViewIdSchema.parse("view-test"),
    ...(compaction === undefined ? {} : { compaction }),
  }
}
