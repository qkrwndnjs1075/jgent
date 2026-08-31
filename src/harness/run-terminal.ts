import type { RunOutcome } from "./contracts.ts"
import { ExecutionInvariantError } from "./errors.ts"
import type { TerminalEventDetails } from "./event-writer.ts"

export function terminalDetails(outcome: RunOutcome): TerminalEventDetails {
  switch (outcome.type) {
    case "completed":
      return { type: "run.completed" }
    case "blocked":
      return {
        type: "run.blocked",
        reason: outcome.reason,
        ...(outcome.displayReason === undefined ? {} : { displayReason: outcome.displayReason }),
        ...(outcome.failure === undefined ? {} : { failure: outcome.failure }),
      }
    case "cancelled":
      return {
        type: "run.cancelled",
        ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
        ...(outcome.displayReason === undefined ? {} : { displayReason: outcome.displayReason }),
        ...(outcome.failure === undefined ? {} : { failure: outcome.failure }),
      }
    case "failed":
      return {
        type: "run.failed",
        reason: outcome.reason,
        ...(outcome.displayReason === undefined ? {} : { displayReason: outcome.displayReason }),
        failure: outcome.failure,
      }
    default:
      return assertNever(outcome)
  }
}

function assertNever(value: never): never {
  throw new ExecutionInvariantError(`Unexpected Run outcome: ${String(value)}`)
}
