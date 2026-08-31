import { expect, test } from "bun:test"
import type { AgentMessage, ModelContinuation } from "../../src/core/index.ts"
import {
  InMemorySessionStore,
  SessionBusyError,
  SessionRevisionConflictError,
  SessionRevisionSchema,
} from "../../src/session/index.ts"

class TestInvariantError extends Error {
  readonly name = "TestInvariantError"
}

test("creates a session that can be loaded with its canonical messages", async () => {
  // Given
  const store = new InMemorySessionStore()
  const session = await store.create()
  const before = await session.snapshot()

  // When
  await session.checkpoint({
    expectedRevision: before.revision,
    append: [{ role: "user", content: "USER_INPUT" }],
  })
  const loaded = await store.load(session.id)

  // Then
  if (loaded === null) {
    throw new TestInvariantError("Expected the created session to load")
  }
  const snapshot = await loaded.snapshot()
  expect(snapshot.id).toBe(session.id)
  expect(snapshot.messages).toEqual([{ role: "user", content: "USER_INPUT" }])
})

test("returns frozen snapshots without aliases to appended messages", async () => {
  // Given
  const session = await new InMemorySessionStore().create()
  const before = await session.snapshot()
  const arguments_ = { options: { path: "before.txt" } }
  const message: AgentMessage = {
    role: "assistant",
    toolCalls: [
      {
        id: "call_1",
        name: "read_file",
        arguments: arguments_,
      },
    ],
  }

  // When
  await session.checkpoint({ expectedRevision: before.revision, append: [message] })
  arguments_.options.path = "after.txt"
  const first = await session.snapshot()
  const second = await session.snapshot()

  // Then
  expect(first).not.toBe(second)
  expect(first.messages).not.toBe(second.messages)
  expect(first.messages[0]).not.toBe(second.messages[0])
  expect(Object.isFrozen(first)).toBe(true)
  expect(Object.isFrozen(first.messages)).toBe(true)
  const firstMessage = first.messages[0]
  if (firstMessage === undefined) {
    throw new TestInvariantError("Expected an appended message")
  }
  expect(Object.isFrozen(firstMessage)).toBe(true)
  expect(first.messages).toEqual([
    {
      role: "assistant",
      toolCalls: [
        {
          id: "call_1",
          name: "read_file",
          arguments: { options: { path: "before.txt" } },
        },
      ],
    },
  ])
})

test("atomically appends messages and clears a bound continuation", async () => {
  // Given
  const session = await new InMemorySessionStore().create()
  const before = await session.snapshot()
  const continuation: ModelContinuation = {
    provider: "test-provider",
    state: "opaque-state",
    consumedMessageCount: 1,
  }

  // When
  const afterAppend = await session.checkpoint({
    expectedRevision: before.revision,
    append: [{ role: "user", content: "USER_INPUT" }],
    continuation: {
      type: "replace",
      continuation,
      instructionFingerprint: "INSTRUCTION_FINGERPRINT",
    },
  })
  const afterClear = await session.checkpoint({
    expectedRevision: afterAppend.revision,
    continuation: { type: "clear" },
  })

  // Then
  if (afterAppend.continuation === undefined) {
    throw new TestInvariantError("Expected a bound continuation")
  }
  expect(afterAppend.messages).toEqual([{ role: "user", content: "USER_INPUT" }])
  expect(afterAppend.continuation.value).toEqual(continuation)
  expect(afterAppend.continuation.contextViewId).toBe(afterAppend.contextViewId)
  expect(afterAppend.continuation.instructionFingerprint).toBe("INSTRUCTION_FINGERPRINT")
  expect(Object.keys(afterAppend.continuation)).toEqual([
    "value",
    "contextViewId",
    "instructionFingerprint",
  ])
  expect(afterClear.continuation).toBeUndefined()
  expect(afterClear.messages).toEqual(afterAppend.messages)
})

test("atomically replaces a bound continuation memory fingerprint", async () => {
  // Given
  const session = await new InMemorySessionStore().create()
  const before = await session.snapshot()

  // When
  const after = await session.checkpoint({
    expectedRevision: before.revision,
    continuation: {
      type: "replace",
      continuation: { provider: "test-provider", state: "opaque-state", consumedMessageCount: 0 },
      memoryFingerprint: "MEMORY_FINGERPRINT_V1",
    },
  })

  // Then
  if (after.continuation === undefined) {
    throw new TestInvariantError("Expected a bound continuation")
  }
  expect(after.continuation.memoryFingerprint).toBe("MEMORY_FINGERPRINT_V1")
  expect(after.revision).toBe(SessionRevisionSchema.parse(1))
})

test("atomically preserves a bound continuation memory fingerprint", async () => {
  // Given
  const session = await new InMemorySessionStore().create()
  const before = await session.snapshot()
  const withFingerprint = await session.checkpoint({
    expectedRevision: before.revision,
    continuation: {
      type: "replace",
      continuation: { provider: "test-provider", state: "opaque-state", consumedMessageCount: 0 },
      memoryFingerprint: "MEMORY_FINGERPRINT_V1",
    },
  })

  // When
  const preserved = await session.checkpoint({
    expectedRevision: withFingerprint.revision,
    append: [{ role: "user", content: "USER_INPUT" }],
  })

  // Then
  if (preserved.continuation === undefined) {
    throw new TestInvariantError("Expected the continuation to be preserved")
  }
  expect(preserved.continuation.memoryFingerprint).toBe("MEMORY_FINGERPRINT_V1")
  expect(preserved.messages).toEqual([{ role: "user", content: "USER_INPUT" }])
})

test("atomically clears a bound continuation memory fingerprint", async () => {
  // Given
  const session = await new InMemorySessionStore().create()
  const before = await session.snapshot()
  const withFingerprint = await session.checkpoint({
    expectedRevision: before.revision,
    continuation: {
      type: "replace",
      continuation: { provider: "test-provider", state: "opaque-state", consumedMessageCount: 0 },
      memoryFingerprint: "MEMORY_FINGERPRINT_V1",
    },
  })

  // When
  const cleared = await session.checkpoint({
    expectedRevision: withFingerprint.revision,
    append: [{ role: "user", content: "USER_INPUT" }],
    continuation: { type: "clear" },
  })

  // Then
  expect(cleared.continuation).toBeUndefined()
  expect(cleared.messages).toEqual([{ role: "user", content: "USER_INPUT" }])
})

test("changes the context view and clears continuation when compaction changes", async () => {
  // Given
  const session = await new InMemorySessionStore().create()
  const before = await session.snapshot()
  const withContinuation = await session.checkpoint({
    expectedRevision: before.revision,
    continuation: {
      type: "replace",
      continuation: { provider: "test-provider", state: "opaque-state", consumedMessageCount: 0 },
    },
  })

  // When
  const compacted = await session.checkpoint({
    expectedRevision: withContinuation.revision,
    compaction: {
      type: "replace",
      checkpoint: {
        summary: "COMPACTED_SUMMARY",
        coveredMessageCount: 0,
        sourceRevision: withContinuation.revision,
      },
    },
  })

  // Then
  expect(compacted.contextViewId).not.toBe(withContinuation.contextViewId)
  expect(compacted.continuation).toBeUndefined()
  expect(compacted.compaction).toEqual({
    summary: "COMPACTED_SUMMARY",
    coveredMessageCount: 0,
    sourceRevision: withContinuation.revision,
  })
})

test("changes the context view and clears continuation when compaction is cleared", async () => {
  // Given
  const session = await new InMemorySessionStore().create()
  const before = await session.snapshot()
  const compacted = await session.checkpoint({
    expectedRevision: before.revision,
    compaction: {
      type: "replace",
      checkpoint: {
        summary: "COMPACTED_SUMMARY",
        coveredMessageCount: 0,
        sourceRevision: before.revision,
      },
    },
  })
  const withContinuation = await session.checkpoint({
    expectedRevision: compacted.revision,
    continuation: {
      type: "replace",
      continuation: { provider: "test-provider", state: "opaque-state", consumedMessageCount: 0 },
    },
  })

  // When
  const cleared = await session.checkpoint({
    expectedRevision: withContinuation.revision,
    compaction: { type: "clear" },
  })

  // Then
  expect(cleared.contextViewId).not.toBe(withContinuation.contextViewId)
  expect(cleared.continuation).toBeUndefined()
  expect(cleared.compaction).toBeUndefined()
})

test("rejects a compaction checkpoint beyond the canonical message count", async () => {
  // Given
  const session = await new InMemorySessionStore().create()
  const before = await session.snapshot()

  // When
  const invalidCheckpoint = session.checkpoint({
    expectedRevision: before.revision,
    compaction: {
      type: "replace",
      checkpoint: {
        summary: "INVALID",
        coveredMessageCount: 1,
        sourceRevision: before.revision,
      },
    },
  })

  // Then
  await expect(invalidCheckpoint).rejects.toThrow("covered message count")
  expect((await session.snapshot()).revision).toBe(before.revision)
})

test("rejects a compaction checkpoint from a stale source revision", async () => {
  // Given
  const session = await new InMemorySessionStore().create()
  const before = await session.snapshot()
  const afterMessage = await session.checkpoint({
    expectedRevision: before.revision,
    append: [{ role: "user", content: "USER_INPUT" }],
  })

  // When
  const invalidCheckpoint = session.checkpoint({
    expectedRevision: afterMessage.revision,
    compaction: {
      type: "replace",
      checkpoint: {
        summary: "STALE",
        coveredMessageCount: 1,
        sourceRevision: before.revision,
      },
    },
  })

  // Then
  await expect(invalidCheckpoint).rejects.toThrow("source revision")
  expect((await session.snapshot()).compaction).toBeUndefined()
})

test("rejects a checkpoint based on a stale revision", async () => {
  // Given
  const session = await new InMemorySessionStore().create()
  const before = await session.snapshot()
  await session.checkpoint({
    expectedRevision: before.revision,
    append: [{ role: "user", content: "FIRST" }],
  })

  // When
  const staleCheckpoint = session.checkpoint({
    expectedRevision: before.revision,
    append: [{ role: "user", content: "STALE" }],
  })

  // Then
  await expect(staleCheckpoint).rejects.toBeInstanceOf(SessionRevisionConflictError)
})

test("rejects concurrent runs for one session and releases the lock after completion", async () => {
  // Given
  const session = await new InMemorySessionStore().create()
  const started = createDeferred()
  const release = createDeferred()
  const firstRun = session.withExclusiveRun(async () => {
    started.resolve()
    await release.promise
    return "FIRST_RESULT"
  })
  await started.promise

  // When
  const concurrentRun = session.withExclusiveRun(async () => "SECOND_RESULT")

  // Then
  await expect(concurrentRun).rejects.toBeInstanceOf(SessionBusyError)
  release.resolve()
  await expect(firstRun).resolves.toBe("FIRST_RESULT")
  await expect(session.withExclusiveRun(async () => "SECOND_RESULT")).resolves.toBe("SECOND_RESULT")
})

type Deferred = {
  readonly promise: Promise<void>
  readonly resolve: () => void
}

function createDeferred(): Deferred {
  let resolve: (() => void) | undefined
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })

  if (resolve === undefined) {
    throw new TestInvariantError("Expected Promise to provide a resolver")
  }

  return { promise, resolve }
}
