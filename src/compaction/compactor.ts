import type { AgentMessage } from "../core/index.ts"
import type { CompactionCheckpoint, SessionSnapshot } from "../session/index.ts"

const MESSAGE_FRAGMENT_CHARACTER_LIMIT = 240
const COMPACTION_ELLIPSIS = "\n…\n"

export type CompactorOptions = {
  readonly maxSummaryCharacters: number
}

export type CompactionInput = {
  readonly snapshot: SessionSnapshot
  readonly coveredMessageCount: number
}

export class Compactor {
  constructor(private readonly options: CompactorOptions) {}

  compact(input: CompactionInput): CompactionCheckpoint {
    const previousCoveredMessageCount = input.snapshot.compaction?.coveredMessageCount ?? 0
    if (
      input.coveredMessageCount <= previousCoveredMessageCount ||
      input.coveredMessageCount > input.snapshot.messages.length
    ) {
      throw new CompactionInputError(input)
    }

    const newMessages = input.snapshot.messages.slice(
      previousCoveredMessageCount,
      input.coveredMessageCount,
    )
    const previousSummary = input.snapshot.compaction?.summary
    const summary = boundSummary({
      newMessages,
      maxCharacters: this.options.maxSummaryCharacters,
      ...(previousSummary === undefined ? {} : { previousSummary }),
    })

    return Object.freeze({
      summary,
      coveredMessageCount: input.coveredMessageCount,
      sourceRevision: input.snapshot.revision,
    })
  }
}

type SummaryInput = {
  readonly previousSummary?: string
  readonly newMessages: readonly AgentMessage[]
  readonly maxCharacters: number
}

function boundSummary(input: SummaryInput): string {
  const fragments = [
    ...(input.previousSummary === undefined ? [] : [input.previousSummary]),
    ...input.newMessages.map(summarizeMessage),
  ]
  return boundText(fragments.join("\n"), input.maxCharacters)
}

function summarizeMessage(message: AgentMessage): string {
  switch (message.role) {
    case "system":
    case "user":
      return `${message.role}: ${boundText(message.content, MESSAGE_FRAGMENT_CHARACTER_LIMIT)}`
    case "assistant":
      return message.toolCalls === undefined
        ? `assistant: ${boundText(message.content, MESSAGE_FRAGMENT_CHARACTER_LIMIT)}`
        : `assistant tool calls: ${message.toolCalls.map(({ name }) => name).join(", ")}`
    case "tool":
      return `tool ${message.result.toolCallId} ${message.result.success ? "succeeded" : "failed"}: ${boundText(
        message.result.output,
        MESSAGE_FRAGMENT_CHARACTER_LIMIT,
      )}`
    default:
      return assertNever(message)
  }
}

function boundText(value: string, maxCharacters: number): string {
  const normalized = value.replaceAll(/\s+/g, " ").trim()
  if (normalized.length <= maxCharacters) {
    return normalized
  }

  const retainedCharacterCount = maxCharacters - COMPACTION_ELLIPSIS.length
  if (retainedCharacterCount <= 0) {
    return COMPACTION_ELLIPSIS.slice(0, maxCharacters)
  }

  const prefixCharacterCount = Math.ceil(retainedCharacterCount / 2)
  const suffixCharacterCount = Math.floor(retainedCharacterCount / 2)
  return `${normalized.slice(0, prefixCharacterCount)}${COMPACTION_ELLIPSIS}${normalized.slice(
    normalized.length - suffixCharacterCount,
  )}`
}

function assertNever(value: never): never {
  throw new CompactorInvariantError(String(value))
}

class CompactorInvariantError extends Error {
  readonly name = "CompactorInvariantError"
}

class CompactionInputError extends Error {
  readonly name = "CompactionInputError"

  constructor(input: CompactionInput) {
    super(`Invalid covered message count: ${input.coveredMessageCount}`)
  }
}
