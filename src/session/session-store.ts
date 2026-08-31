import {
  type AgentSession,
  createSessionId,
  InMemoryAgentSession,
  type SessionId,
} from "./session.ts"

export interface SessionStore {
  create(): Promise<AgentSession>

  load(id: SessionId): Promise<AgentSession | null>
}

export class InMemorySessionStore implements SessionStore {
  #sessions = new Map<SessionId, InMemoryAgentSession>()

  async create(): Promise<AgentSession> {
    const session = new InMemoryAgentSession(createSessionId())
    this.#sessions.set(session.id, session)
    return session
  }

  async load(id: SessionId): Promise<AgentSession | null> {
    return this.#sessions.get(id) ?? null
  }
}
