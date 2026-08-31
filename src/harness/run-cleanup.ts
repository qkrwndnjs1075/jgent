import { abortReason } from "./abort-scope.ts"
import type { ActiveRun } from "./active-run.ts"
import { ExecutionFailedError, ExecutionHarnessError } from "./errors.ts"

export async function closeRunForFailure(
  run: ActiveRun,
): Promise<ExecutionHarnessError | undefined> {
  try {
    await run.options.scope.cancelAndJoin({
      reason: abortReason(run.context.signal),
      timeoutMs: run.options.budget.budget.cleanupTimeoutMs,
    })
    return undefined
  } catch (error) {
    return error instanceof ExecutionHarnessError ? error : new ExecutionFailedError(error)
  }
}
