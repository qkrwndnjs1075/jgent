import type { ToolCall, ToolResult } from "../core/index.ts"
import type { PreparedToolCall } from "../tool/index.ts"
import { abortReason, createAbortScope, runAbortable, waitForSettlement } from "./abort-scope.ts"
import type { ActiveRun } from "./active-run.ts"
import {
  AttemptIdSchema,
  AttemptNumberSchema,
  ItemIdSchema,
  type TurnContext,
} from "./contracts.ts"
import {
  ExecutionCancelledError,
  ExecutionCleanupTimeoutError,
  ExecutionTimeoutError,
} from "./errors.ts"
import type { ExecutionScope } from "./execution-scope.ts"
import type { ItemRegistry } from "./item-registry.ts"
import { failureFor, toolResultFailure } from "./tool-failure.ts"

export type ToolAttemptInput = {
  readonly run: ActiveRun
  readonly context: TurnContext
  readonly scope: ExecutionScope
  readonly items: ItemRegistry
  readonly itemId: string
  readonly call: ToolCall
  readonly prepared: PreparedToolCall
}

export async function executePreparedToolAttempt(input: ToolAttemptInput): Promise<ToolResult> {
  const attempt = input.items.startAttempt(input.itemId)
  const attemptId = AttemptIdSchema.parse(attempt.record.attemptId)
  const attemptNumber = AttemptNumberSchema.parse(attempt.record.attemptNumber)
  const attemptScope = createAbortScope(
    input.scope.signal,
    input.run.options.budget.budget.toolTimeoutMs,
    new ExecutionTimeoutError("tool"),
  )
  let execution: Promise<ToolResult> | undefined

  try {
    await input.run.emit({
      type: "tool.started",
      phase: "execution",
      turnId: input.context.turnId,
      itemId: ItemIdSchema.parse(input.itemId),
      attemptId,
      attempt: attemptNumber,
      toolCallId: input.call.id,
      toolName: input.call.name,
    })
    if (attemptScope.signal.aborted) {
      throw abortReason(attemptScope.signal)
    }
    const executionContext = {
      signal: attemptScope.signal,
      cleanup: {
        graceMs: Math.min(250, input.run.options.budget.budget.cleanupTimeoutMs),
        cleanupTimeoutMs: input.run.options.budget.budget.cleanupTimeoutMs,
      },
    }
    execution = input.run.options.sandbox.execute(input.prepared, executionContext, (context) =>
      input.run.options.toolRuntime.executePrepared(input.prepared, context),
    )
    return await runToolAttempt({
      input,
      attempt,
      attemptScope,
      execution,
      attemptId,
      attemptNumber,
    })
  } catch (error) {
    const current = input.items.get(input.itemId)
    if (current?.state === "executing") {
      if (error instanceof ExecutionCancelledError) {
        attempt.cancel()
      } else {
        attempt.fail()
      }
    }
    throw error
  } finally {
    attemptScope.dispose()
  }
}

type ToolAttemptRun = {
  readonly input: ToolAttemptInput
  readonly attempt: ReturnType<ItemRegistry["startAttempt"]>
  readonly attemptScope: ReturnType<typeof createAbortScope>
  readonly execution: Promise<ToolResult>
  readonly attemptId: ReturnType<typeof AttemptIdSchema.parse>
  readonly attemptNumber: ReturnType<typeof AttemptNumberSchema.parse>
}

async function runToolAttempt(details: ToolAttemptRun): Promise<ToolResult> {
  const { input, attempt, attemptScope, execution, attemptId, attemptNumber } = details
  try {
    const result = await runAbortable(attemptScope, () => execution)
    if (result.success) {
      attempt.complete()
      await input.run.emit({
        type: "tool.completed",
        phase: "execution",
        turnId: input.context.turnId,
        itemId: ItemIdSchema.parse(input.itemId),
        attemptId,
        attempt: attemptNumber,
        toolCallId: input.call.id,
        toolName: input.call.name,
      })
      return result
    }

    attempt.fail()
    await input.run.emit({
      type: "tool.failed",
      phase: "execution",
      turnId: input.context.turnId,
      itemId: ItemIdSchema.parse(input.itemId),
      attemptId,
      attempt: attemptNumber,
      toolCallId: input.call.id,
      toolName: input.call.name,
      reason: "Tool returned a failure",
      failure: toolResultFailure(result.error),
    })
    return result
  } catch (error) {
    const settled = await waitForSettlement(
      execution,
      input.run.options.budget.budget.cleanupTimeoutMs,
    )
    if (!settled) {
      attempt.fail()
      throw new ExecutionCleanupTimeoutError("tool")
    }
    if (error instanceof ExecutionCancelledError) {
      attempt.cancel()
      await input.run.emit({
        type: "tool.cancelled",
        phase: "execution",
        turnId: input.context.turnId,
        itemId: ItemIdSchema.parse(input.itemId),
        attemptId,
        attempt: attemptNumber,
        toolCallId: input.call.id,
        toolName: input.call.name,
        reason: error.message,
        failure: error.failure,
      })
      throw error
    }
    if (error instanceof ExecutionTimeoutError && error.scope === "tool") {
      attempt.fail()
      await input.run.emit({
        type: "tool.failed",
        phase: "execution",
        turnId: input.context.turnId,
        itemId: ItemIdSchema.parse(input.itemId),
        attemptId,
        attempt: attemptNumber,
        toolCallId: input.call.id,
        toolName: input.call.name,
        reason: "Tool execution timed out",
        failure: error.failure,
      })
      return {
        toolCallId: input.call.id,
        success: false,
        output: "",
        error: "Tool execution timed out",
      }
    }
    attempt.fail()
    await input.run.emit({
      type: "tool.failed",
      phase: "execution",
      turnId: input.context.turnId,
      itemId: ItemIdSchema.parse(input.itemId),
      attemptId,
      attempt: attemptNumber,
      toolCallId: input.call.id,
      toolName: input.call.name,
      reason: "Tool execution failed",
      failure: failureFor(error),
    })
    throw error
  }
}
