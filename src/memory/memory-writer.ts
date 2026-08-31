import { createHash, randomUUID } from "node:crypto"
import {
  type CompletedRunMemoryInput,
  type MemoryCandidate,
  MemoryCandidateSchema,
  type MemoryId,
  MemoryIdSchema,
  type MemoryRecord,
  MemoryRecordSchema,
  type MemoryScope,
} from "./memory.ts"
import type { MemoryCandidateExtractor } from "./memory-candidate-extractor.ts"
import type { MemoryPolicy, MemoryPolicyDiscardReason } from "./memory-policy.ts"
import type { MemoryPutResult, MemoryStore } from "./memory-store.ts"
import { type MemoryWriteSummary, summarizeMemoryWrite } from "./memory-write-summary.ts"

export interface MemoryWriter {
  write(input: CompletedRunMemoryInput): Promise<MemoryWriteSummary>
}

export type MemoryWriterOptions = {
  readonly extractor: MemoryCandidateExtractor
  readonly policy: MemoryPolicy
  readonly store: MemoryStore
  readonly now?: () => number
  readonly createId?: () => MemoryId
}

export class DefaultMemoryWriter implements MemoryWriter {
  readonly #extractor: MemoryCandidateExtractor
  readonly #policy: MemoryPolicy
  readonly #store: MemoryStore
  readonly #now: () => number
  readonly #createId: () => MemoryId

  constructor(options: MemoryWriterOptions) {
    this.#extractor = options.extractor
    this.#policy = options.policy
    this.#store = options.store
    this.#now = options.now ?? Date.now
    this.#createId = options.createId ?? (() => MemoryIdSchema.parse(randomUUID()))
  }

  async write(input: CompletedRunMemoryInput): Promise<MemoryWriteSummary> {
    input.signal.throwIfAborted()
    const source = freezeCompletedRun(input)
    const candidates = await this.#extractor.extract(source)
    const records: MemoryRecord[] = []
    const discardReasons: MemoryPolicyDiscardReason[] = []
    let approvedCount = 0
    for (const candidateValue of candidates) {
      const parsed = MemoryCandidateSchema.safeParse(candidateValue)
      if (!parsed.success) {
        discardReasons.push("invalid_candidate")
        continue
      }
      const candidate = parsed.data
      const decision = this.#policy.evaluate({ candidate, completedRun: source })
      switch (decision.type) {
        case "approve":
          approvedCount += 1
          records.push(this.createRecord(candidate, source))
          break
        case "discard":
          discardReasons.push(decision.reason)
          break
        default:
          return assertNever(decision)
      }
    }

    source.signal.throwIfAborted()
    let results: readonly MemoryPutResult[] = []
    if (records.length > 0) {
      try {
        results = await this.#store.put(records)
      } catch (error) {
        if (error instanceof MemoryWriterInvariantError) {
          throw error
        }
        if (error instanceof Error) {
          throw new MemoryWriterInvariantError("Memory persistence failed", { cause: error })
        }
        throw error
      }
    }
    return summarizeMemoryWrite(candidates.length, approvedCount, discardReasons, results)
  }

  private createRecord(candidate: MemoryCandidate, source: CompletedRunMemoryInput): MemoryRecord {
    const scope = materializeScope(candidate.targetScope, source.accessScope)
    const messageRange = {
      start: source.messageRange.start + candidate.sourceRange.start,
      end: source.messageRange.start + candidate.sourceRange.end,
    }
    if (candidate.sourceRange.end > source.messages.length) {
      throw new MemoryWriterInvariantError("Candidate source range escaped the completed Run")
    }
    const content = candidate.content.normalize("NFC").trim()
    const tags = candidate.tags.map((tag) => tag.normalize("NFC").trim())
    const subjectKey =
      candidate.kind === "preference" ? candidate.subjectKey.normalize("NFC").trim() : undefined
    const deduplicationKey = digest({
      kind: candidate.kind,
      content,
      scope,
      ...(subjectKey === undefined ? {} : { subjectKey }),
    })
    return MemoryRecordSchema.parse({
      id: this.#createId(),
      deduplicationKey,
      fingerprint: deduplicationKey,
      kind: candidate.kind,
      content,
      tags,
      scope,
      ...(subjectKey === undefined ? {} : { subjectKey }),
      source: {
        sessionId: source.sessionId,
        sourceRevision: source.sourceRevision,
        messageRange,
      },
      createdAt: this.#now(),
    })
  }
}

function materializeScope(
  target: MemoryCandidate["targetScope"],
  access: CompletedRunMemoryInput["accessScope"],
): MemoryScope {
  switch (target) {
    case "workspace":
      if (access.type === "workspace" || access.type === "workspace_user") {
        return access.type === "workspace"
          ? access
          : { type: "workspace", workspaceId: access.workspaceId }
      }
      break
    case "user":
      if (access.type === "user" || access.type === "workspace_user") {
        return access.type === "user" ? access : { type: "user", userId: access.userId }
      }
      break
    case "workspace_user":
      if (access.type === "workspace_user") {
        return access
      }
      break
    default:
      return assertNever(target)
  }
  throw new MemoryWriterInvariantError("Candidate scope is unavailable for this Run")
}

function freezeCompletedRun(input: CompletedRunMemoryInput): CompletedRunMemoryInput {
  if (
    input.messageRange.end - input.messageRange.start !== input.messages.length ||
    input.messageRange.start < 0
  ) {
    throw new MemoryWriterInvariantError("Completed Run range does not match its messages")
  }
  return Object.freeze({
    sessionId: input.sessionId,
    sourceRevision: input.sourceRevision,
    messageRange: Object.freeze({ ...input.messageRange }),
    task: input.task,
    accessScope: deepFreeze(structuredClone(input.accessScope)),
    messages: deepFreeze(structuredClone(input.messages)),
    signal: input.signal,
  })
}

function digest(value: object): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")
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

function assertNever(value: never): never {
  throw new MemoryWriterInvariantError(`Unexpected Memory policy: ${String(value)}`)
}

export class MemoryWriterInvariantError extends Error {
  readonly name = "MemoryWriterInvariantError"
}
