import type { AgentMessage } from "../core/index.ts"
import type { SessionSnapshot } from "../session/index.ts"

export type CompactionDecision =
  | { readonly type: "keep" }
  | { readonly type: "compact"; readonly coveredMessageCount: number }

export type CompactionPolicyOptions = {
  readonly maxMessageCount: number
  readonly recentMessageCount: number
}

export class CompactionPolicy {
  constructor(private readonly options: CompactionPolicyOptions) {}

  decide(snapshot: SessionSnapshot): CompactionDecision {
    const coveredMessageCount = snapshot.compaction?.coveredMessageCount ?? 0
    const activeMessageCount = snapshot.messages.length - coveredMessageCount

    if (activeMessageCount <= this.options.maxMessageCount) {
      return { type: "keep" }
    }

    const desiredCoveredMessageCount = snapshot.messages.length - this.options.recentMessageCount
    const safeCoveredMessageCount = findSafeCoveredMessageCount({
      messages: snapshot.messages,
      desiredCoveredMessageCount,
      minimumCoveredMessageCount: coveredMessageCount,
    })

    return safeCoveredMessageCount === undefined
      ? { type: "keep" }
      : { type: "compact", coveredMessageCount: safeCoveredMessageCount }
  }
}

type SafeBoundarySearch = {
  readonly messages: readonly AgentMessage[]
  readonly desiredCoveredMessageCount: number
  readonly minimumCoveredMessageCount: number
}

function findSafeCoveredMessageCount(search: SafeBoundarySearch): number | undefined {
  for (
    let candidate = search.desiredCoveredMessageCount;
    candidate > search.minimumCoveredMessageCount;
    candidate -= 1
  ) {
    if (isSafeBoundary(search.messages, candidate)) {
      return candidate
    }
  }

  return undefined
}

function isSafeBoundary(messages: readonly AgentMessage[], coveredMessageCount: number): boolean {
  if (coveredMessageCount < 0 || coveredMessageCount > messages.length) {
    return false
  }

  const firstRetainedMessage = messages[coveredMessageCount]
  if (firstRetainedMessage?.role === "tool") {
    return false
  }

  return (
    isClosedTranscript(messages.slice(0, coveredMessageCount)) &&
    isClosedTranscript(messages.slice(coveredMessageCount))
  )
}

function isClosedTranscript(messages: readonly AgentMessage[]): boolean {
  const pendingToolCallIds = new Set<string>()
  for (const message of messages) {
    switch (message.role) {
      case "assistant":
        if (pendingToolCallIds.size > 0) {
          return false
        }
        if (message.toolCalls !== undefined) {
          for (const toolCall of message.toolCalls) {
            if (pendingToolCallIds.has(toolCall.id)) {
              return false
            }
            pendingToolCallIds.add(toolCall.id)
          }
        }
        break
      case "tool":
        if (!pendingToolCallIds.delete(message.result.toolCallId)) {
          return false
        }
        break
      case "system":
      case "user":
        if (pendingToolCallIds.size > 0) {
          return false
        }
        break
      default:
        return assertNever(message)
    }
  }

  return pendingToolCallIds.size === 0
}

function assertNever(value: never): never {
  throw new CompactionPolicyInvariantError(String(value))
}

class CompactionPolicyInvariantError extends Error {
  readonly name = "CompactionPolicyInvariantError"
}
