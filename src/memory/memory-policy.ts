import type { AgentMessage } from "../core/index.ts"
import type { CompletedRunMemoryInput, MemoryCandidate } from "./memory.ts"

export const MemoryPolicyDiscardReason = {
  notDurable: "not_durable",
  notGeneralizable: "not_generalizable",
  sensitive: "sensitive",
  rawHistory: "raw_history",
  invalidCandidate: "invalid_candidate",
  invalidSourceRange: "invalid_source_range",
  toolSource: "tool_source",
  scopeNotVisible: "scope_not_visible",
  credentialMarker: "credential_marker",
} as const

export type MemoryPolicyDiscardReason =
  (typeof MemoryPolicyDiscardReason)[keyof typeof MemoryPolicyDiscardReason]

export type MemoryPolicyInput = {
  readonly candidate: MemoryCandidate
  readonly completedRun: CompletedRunMemoryInput
}

export type MemoryPolicyDecision =
  | { readonly type: "approve" }
  | { readonly type: "discard"; readonly reason: MemoryPolicyDiscardReason }

export interface MemoryPolicy {
  evaluate(input: MemoryPolicyInput): MemoryPolicyDecision
}

export class DefaultMemoryPolicy implements MemoryPolicy {
  evaluate(input: MemoryPolicyInput): MemoryPolicyDecision {
    const { candidate, completedRun } = input
    if (!candidate.durable) {
      return discard("not_durable")
    }
    if (!candidate.generalizable) {
      return discard("not_generalizable")
    }
    if (candidate.sensitivity !== "non_sensitive") {
      return discard("sensitive")
    }
    if (candidate.rawHistory) {
      return discard("raw_history")
    }
    if (!validSourceRange(candidate, completedRun)) {
      return discard("invalid_source_range")
    }
    if (containsToolMessage(completedRun.messages, candidate.sourceRange)) {
      return discard("tool_source")
    }
    if (!visibleScope(candidate.targetScope, completedRun.accessScope.type)) {
      return discard("scope_not_visible")
    }
    if (unsafeContent(candidate.content)) {
      return discard("credential_marker")
    }
    return { type: "approve" }
  }
}

function discard(reason: MemoryPolicyDiscardReason): MemoryPolicyDecision {
  return { type: "discard", reason }
}

function validSourceRange(
  candidate: MemoryCandidate,
  completedRun: CompletedRunMemoryInput,
): boolean {
  const { start, end } = candidate.sourceRange
  return start < end && end <= completedRun.messages.length
}

function containsToolMessage(
  messages: readonly AgentMessage[],
  range: { readonly start: number; readonly end: number },
): boolean {
  return messages.slice(range.start, range.end).some((message) => message.role === "tool")
}

function visibleScope(
  targetScope: MemoryCandidate["targetScope"],
  accessScope: CompletedRunMemoryInput["accessScope"]["type"],
): boolean {
  if (accessScope === "workspace_user") {
    return true
  }
  return targetScope === accessScope
}

function unsafeContent(content: string): boolean {
  return /(?:api[_ -]?key|secret|token|password)\s*[:=]|-----BEGIN|(?:ignore|disregard)\s+(?:all\s+)?(?:previous|prior|current)\s+instructions|(?:bypass|override)\s+(?:the\s+)?(?:policy|restrictions?)/i.test(
    content,
  )
}
