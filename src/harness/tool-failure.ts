import type { ToolResult } from "../core/index.ts"
import type { ExecutionFailure } from "./contracts.ts"
import { ExecutionFailedError, ExecutionHarnessError } from "./errors.ts"

export function isTerminalItemState(state: string): boolean {
  return state === "completed" || state === "failed" || state === "denied" || state === "cancelled"
}

export function preparationFailure(message: string): ExecutionFailure {
  return {
    kind: "tool",
    message,
    displayReason: "Tool preparation failed",
    retryable: false,
    scope: "tool",
  }
}

export function preparationMessage(result: ToolResult): string {
  return result.success ? "Tool preparation failed" : result.error
}

export function toolResultFailure(message: string): ExecutionFailure {
  return {
    kind: "tool",
    message,
    displayReason: "Tool returned a failure",
    retryable: false,
    scope: "tool",
  }
}

export function failureFor(error: unknown): ExecutionFailure {
  if (error instanceof ExecutionHarnessError) {
    return error.failure
  }
  return new ExecutionFailedError(error).failure
}

export function deniedResult(toolCallId: string, error: string): ToolResult {
  return { toolCallId, success: false, output: "", error }
}
