import { z } from "zod"
import type { AgentMessage, ModelContinuation } from "../core/index.ts"

export const SessionIdSchema = z.string().min(1).brand<"SessionId">()
export type SessionId = z.infer<typeof SessionIdSchema>

export const SessionRevisionSchema = z.number().int().nonnegative().brand<"SessionRevision">()
export type SessionRevision = z.infer<typeof SessionRevisionSchema>

export const ContextViewIdSchema = z.string().min(1).brand<"ContextViewId">()
export type ContextViewId = z.infer<typeof ContextViewIdSchema>

export type BoundContinuation = {
  readonly value: ModelContinuation
  readonly contextViewId: ContextViewId
  readonly instructionFingerprint?: string
  readonly memoryFingerprint?: string
}

export type CompactionCheckpoint = {
  readonly summary: string
  readonly coveredMessageCount: number
  readonly sourceRevision: SessionRevision
}

export type SessionSnapshot = {
  readonly id: SessionId
  readonly revision: SessionRevision
  readonly messages: readonly AgentMessage[]
  readonly contextViewId: ContextViewId
  readonly continuation?: BoundContinuation
  readonly compaction?: CompactionCheckpoint
}

export type ContinuationUpdate =
  | { readonly type: "preserve" }
  | {
      readonly type: "replace"
      readonly continuation: ModelContinuation
      readonly instructionFingerprint?: string
      readonly memoryFingerprint?: string
    }
  | { readonly type: "clear" }

export type CompactionUpdate =
  | { readonly type: "preserve" }
  | { readonly type: "replace"; readonly checkpoint: CompactionCheckpoint }
  | { readonly type: "clear" }

export type SessionCommit = {
  readonly expectedRevision: SessionRevision
  readonly append?: readonly AgentMessage[]
  readonly continuation?: ContinuationUpdate
  readonly compaction?: CompactionUpdate
}

export interface AgentSession {
  readonly id: SessionId

  snapshot(): Promise<SessionSnapshot>

  checkpoint(commit: SessionCommit): Promise<SessionSnapshot>

  withExclusiveRun<T>(operation: () => Promise<T>): Promise<T>
}

export class SessionRevisionConflictError extends Error {
  readonly name = "SessionRevisionConflictError"

  constructor(
    readonly expectedRevision: SessionRevision,
    readonly actualRevision: SessionRevision,
  ) {
    super(`Session revision ${expectedRevision} does not match current revision ${actualRevision}`)
  }
}

export class SessionBusyError extends Error {
  readonly name = "SessionBusyError"

  constructor(readonly sessionId: SessionId) {
    super(`Session ${sessionId} already has an active run`)
  }
}

export class InMemoryAgentSession implements AgentSession {
  #state: SessionSnapshot
  #hasActiveRun = false

  constructor(readonly id: SessionId) {
    this.#state = freezeSnapshot({
      id,
      revision: SessionRevisionSchema.parse(0),
      messages: [],
      contextViewId: createContextViewId(),
    })
  }

  async snapshot(): Promise<SessionSnapshot> {
    return cloneSnapshot(this.#state)
  }

  async checkpoint(commit: SessionCommit): Promise<SessionSnapshot> {
    if (commit.expectedRevision !== this.#state.revision) {
      throw new SessionRevisionConflictError(commit.expectedRevision, this.#state.revision)
    }

    const compaction = commit.compaction ?? { type: "preserve" }
    const continuation = commit.continuation ?? { type: "preserve" }
    const nextRevision = SessionRevisionSchema.parse(this.#state.revision + 1)
    const nextMessages = [...this.#state.messages, ...(commit.append ?? [])]

    switch (compaction.type) {
      case "preserve":
        this.#state = freezeSnapshot({
          id: this.id,
          revision: nextRevision,
          messages: nextMessages,
          contextViewId: this.#state.contextViewId,
          ...continuationFields(continuation, this.#state),
          ...preservedCompactionFields(this.#state),
        })
        break
      case "replace":
        validateCompactionCheckpoint(
          compaction.checkpoint,
          nextMessages.length,
          this.#state.revision,
        )
        this.#state = freezeSnapshot({
          id: this.id,
          revision: nextRevision,
          messages: nextMessages,
          contextViewId: createContextViewId(),
          compaction: compaction.checkpoint,
        })
        break
      case "clear":
        this.#state = freezeSnapshot({
          id: this.id,
          revision: nextRevision,
          messages: nextMessages,
          contextViewId: createContextViewId(),
        })
        break
      default:
        return assertNever(compaction)
    }

    return cloneSnapshot(this.#state)
  }

  async withExclusiveRun<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#hasActiveRun) {
      throw new SessionBusyError(this.id)
    }

    this.#hasActiveRun = true
    try {
      return await operation()
    } finally {
      this.#hasActiveRun = false
    }
  }
}

function validateCompactionCheckpoint(
  checkpoint: CompactionCheckpoint,
  messageCount: number,
  sourceRevision: SessionRevision,
): void {
  if (
    !Number.isInteger(checkpoint.coveredMessageCount) ||
    checkpoint.coveredMessageCount < 0 ||
    checkpoint.coveredMessageCount > messageCount
  ) {
    throw new SessionInvariantError("Invalid compaction covered message count")
  }
  if (checkpoint.sourceRevision !== sourceRevision) {
    throw new SessionInvariantError("Invalid compaction source revision")
  }
}

function continuationFields(
  update: ContinuationUpdate,
  state: SessionSnapshot,
): Pick<SessionSnapshot, "continuation"> | object {
  switch (update.type) {
    case "preserve":
      return state.continuation === undefined ? {} : { continuation: state.continuation }
    case "replace":
      return {
        continuation: {
          value: update.continuation,
          contextViewId: state.contextViewId,
          ...(update.instructionFingerprint === undefined
            ? {}
            : { instructionFingerprint: update.instructionFingerprint }),
          ...(update.memoryFingerprint === undefined
            ? {}
            : { memoryFingerprint: update.memoryFingerprint }),
        },
      }
    case "clear":
      return {}
    default:
      return assertNever(update)
  }
}

function preservedCompactionFields(
  state: SessionSnapshot,
): Pick<SessionSnapshot, "compaction"> | object {
  return state.compaction === undefined ? {} : { compaction: state.compaction }
}

function cloneSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  return freezeSnapshot(snapshot)
}

function freezeSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  return deepFreeze(structuredClone(snapshot))
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value
  }

  for (const child of Object.values(value)) {
    deepFreeze(child)
  }

  return Object.freeze(value)
}

function createContextViewId(): ContextViewId {
  return ContextViewIdSchema.parse(crypto.randomUUID())
}

export function createSessionId(): SessionId {
  return SessionIdSchema.parse(crypto.randomUUID())
}

function assertNever(value: never): never {
  throw new SessionInvariantError(`Unexpected session update: ${String(value)}`)
}

class SessionInvariantError extends Error {
  readonly name = "SessionInvariantError"
}
