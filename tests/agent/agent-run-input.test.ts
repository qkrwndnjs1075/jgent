import { expect, test } from "bun:test"
import {
  AgentLoopInvariantError,
  resolveAgentRunInput,
  SessionNotFoundError,
} from "../../src/agent/agent-run-input.ts"
import type { StartRunInput } from "../../src/harness/index.ts"
import {
  type AgentSession,
  InMemoryAgentSession,
  type SessionId,
  SessionIdSchema,
  type SessionStore,
} from "../../src/session/index.ts"

class RecordingSessionStore implements SessionStore {
  readonly createCalls: AgentSession[] = []
  readonly loadCalls: SessionId[] = []

  constructor(
    private readonly createdSession: AgentSession,
    private readonly loadedSessions: ReadonlyMap<SessionId, AgentSession> = new Map(),
  ) {}

  async create(): Promise<AgentSession> {
    this.createCalls.push(this.createdSession)
    return this.createdSession
  }

  async load(id: SessionId): Promise<AgentSession | null> {
    this.loadCalls.push(id)
    return this.loadedSessions.get(id) ?? null
  }
}

test("creates one session when string-first input has no session ID", async () => {
  // Given
  const createdSession = session("created")
  const sessionStore = new RecordingSessionStore(createdSession)
  const options = { signal: new AbortController().signal }

  // When
  const resolved = await resolveAgentRunInput({
    sessionStore,
    sessionOrInput: "USER_INPUT",
    userInputOrOptions: options,
    explicitOptions: {},
  })

  // Then
  expect(resolved.session).toBe(createdSession)
  expect(resolved.userInput).toBe("USER_INPUT")
  expect(resolved.options).toBe(options)
  expect(sessionStore.createCalls).toEqual([createdSession])
  expect(sessionStore.loadCalls).toEqual([])
})

test("loads one session when string-first input has a session ID", async () => {
  // Given
  const sessionId = SessionIdSchema.parse("loaded")
  const loadedSession = session("loaded")
  const sessionStore = new RecordingSessionStore(
    session("created"),
    new Map([[sessionId, loadedSession]]),
  )
  const options = { sessionId, signal: new AbortController().signal }

  // When
  const resolved = await resolveAgentRunInput({
    sessionStore,
    sessionOrInput: "USER_INPUT",
    userInputOrOptions: options,
    explicitOptions: {},
  })

  // Then
  expect(resolved.session).toBe(loadedSession)
  expect(resolved.userInput).toBe("USER_INPUT")
  expect(resolved.options).toBe(options)
  expect(sessionStore.createCalls).toEqual([])
  expect(sessionStore.loadCalls).toEqual([sessionId])
})

test("uses the exact explicit session and options without session-store access", async () => {
  // Given
  const explicitSession = session("explicit")
  const sessionStore = new RecordingSessionStore(session("created"))
  const explicitOptions: StartRunInput = { signal: new AbortController().signal }

  // When
  const resolved = await resolveAgentRunInput({
    sessionStore,
    sessionOrInput: explicitSession,
    userInputOrOptions: "USER_INPUT",
    explicitOptions,
  })

  // Then
  expect(resolved.session).toBe(explicitSession)
  expect(resolved.userInput).toBe("USER_INPUT")
  expect(resolved.options).toBe(explicitOptions)
  expect(sessionStore.createCalls).toEqual([])
  expect(sessionStore.loadCalls).toEqual([])
})

test("rejects an unknown session ID without creating a session", async () => {
  // Given
  const sessionId = SessionIdSchema.parse("missing")
  const sessionStore = new RecordingSessionStore(session("created"))

  // When
  const resolution = resolveAgentRunInput({
    sessionStore,
    sessionOrInput: "USER_INPUT",
    userInputOrOptions: { sessionId },
    explicitOptions: {},
  })

  // Then
  try {
    await resolution
    throw new TestInvariantError("Expected a missing session to reject")
  } catch (error) {
    if (!(error instanceof SessionNotFoundError)) {
      throw error
    }
    expect(error.name).toBe("SessionNotFoundError")
    expect(error.message).toBe("Session missing was not found")
    expect(error.sessionId).toBe(sessionId)
  }
  expect(sessionStore.createCalls).toEqual([])
  expect(sessionStore.loadCalls).toEqual([sessionId])
})

test("rejects explicit-session input without a user-input string", async () => {
  // Given
  const explicitSession = session("explicit")
  const sessionStore = new RecordingSessionStore(session("created"))

  // When
  const resolution = resolveAgentRunInput({
    sessionStore,
    sessionOrInput: explicitSession,
    userInputOrOptions: {},
    explicitOptions: {},
  })

  // Then
  try {
    await resolution
    throw new TestInvariantError("Expected missing user input to reject")
  } catch (error) {
    if (!(error instanceof AgentLoopInvariantError)) {
      throw error
    }
    expect(error.name).toBe("AgentLoopInvariantError")
    expect(error.message).toBe("A Session run requires user input")
  }
  expect(sessionStore.createCalls).toEqual([])
  expect(sessionStore.loadCalls).toEqual([])
})

function session(id: string): AgentSession {
  return new InMemoryAgentSession(SessionIdSchema.parse(id))
}

class TestInvariantError extends Error {
  readonly name = "TestInvariantError"
}
