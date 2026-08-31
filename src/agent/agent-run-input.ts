import type { StartRunInput } from "../harness/index.ts"
import type { AgentSession, SessionId, SessionStore } from "../session/index.ts"

export type AgentRunOptions = StartRunInput & {
  readonly sessionId?: SessionId
}

export type ResolveAgentRunInputInput = {
  readonly sessionStore: SessionStore
  readonly sessionOrInput: AgentSession | string
  readonly userInputOrOptions: AgentRunOptions | string
  readonly explicitOptions: StartRunInput
}

export type ResolvedAgentRunInput = {
  readonly session: AgentSession
  readonly userInput: string
  readonly options: AgentRunOptions
}

export async function resolveAgentRunInput(
  input: ResolveAgentRunInputInput,
): Promise<ResolvedAgentRunInput> {
  const { sessionStore, sessionOrInput, userInputOrOptions, explicitOptions } = input
  if (typeof sessionOrInput !== "string") {
    if (typeof userInputOrOptions !== "string") {
      throw new AgentLoopInvariantError("A Session run requires user input")
    }
    return {
      session: sessionOrInput,
      userInput: userInputOrOptions,
      options: explicitOptions,
    }
  }

  const options: AgentRunOptions =
    typeof userInputOrOptions === "string" ? { ...explicitOptions } : userInputOrOptions
  const session =
    options.sessionId === undefined
      ? await sessionStore.create()
      : await loadSession(sessionStore, options.sessionId)
  return {
    session,
    userInput: sessionOrInput,
    options,
  }
}

async function loadSession(
  sessionStore: SessionStore,
  sessionId: SessionId,
): Promise<AgentSession> {
  const session = await sessionStore.load(sessionId)
  if (session === null) {
    throw new SessionNotFoundError(sessionId)
  }
  return session
}

export class AgentLoopInvariantError extends Error {
  readonly name = "AgentLoopInvariantError"
}

export class SessionNotFoundError extends Error {
  readonly name = "SessionNotFoundError"

  constructor(readonly sessionId: SessionId) {
    super(`Session ${sessionId} was not found`)
  }
}
