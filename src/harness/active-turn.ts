import type { ModelOutput, ToolCall, ToolResult } from "../core/index.ts"
import { createAbortScope, runAbortable, runAbortableOperation } from "./abort-scope.ts"
import type { ActiveRun } from "./active-run.ts"
import {
  AttemptIdSchema,
  AttemptNumberSchema,
  type ExecutionAttemptContext,
  type TurnContext,
  type TurnExecution,
} from "./contracts.ts"
import {
  ExecutionBlockedError,
  ExecutionCancelledError,
  ExecutionCleanupTimeoutError,
  ExecutionFailedError,
  ExecutionHarnessError,
  ExecutionInvariantError,
  ExecutionTimeoutError,
} from "./errors.ts"
import type { ExecutionScope } from "./execution-scope.ts"
import type { ItemRegistry } from "./item-registry.ts"
import { executeToolItem } from "./tool-executor.ts"

export class ActiveTurn implements TurnExecution {
  readonly context: TurnContext
  readonly #scope: ExecutionScope
  readonly #items: ItemRegistry
  readonly #children: Promise<unknown>[] = []
  #state: "open" | "closing" | "closed" = "open"
  #modelClaimed = false
  #toolsClaimed = false
  #completionClaimed = false
  #modelOutput: ModelOutput | undefined

  constructor(
    private readonly run: ActiveRun,
    context: TurnContext,
    scope: ExecutionScope,
    items: ItemRegistry,
  ) {
    this.context = context
    this.#scope = scope
    this.#items = items
  }

  async executeModel(
    operation: (context: ExecutionAttemptContext) => Promise<ModelOutput>,
  ): Promise<ModelOutput> {
    this.ensureOpen()
    if (this.#modelClaimed) {
      throw new ExecutionInvariantError("A Turn can execute only one logical model call")
    }
    this.#modelClaimed = true
    const task = this.#scope.spawn(() => this.executeModelAttempt(operation))
    this.#children.push(task)
    return task
  }

  async executeTools(calls: readonly ToolCall[]): Promise<readonly ToolResult[]> {
    this.ensureOpen()
    if (this.#toolsClaimed) {
      throw new ExecutionInvariantError("A Turn can execute only one Tool batch")
    }
    if (this.#modelOutput?.stopReason !== "tool_calls" || this.#modelOutput.toolCalls !== calls) {
      throw new ExecutionInvariantError("A Turn may execute only Tool calls from its model output")
    }
    this.#toolsClaimed = true
    this.run.claimToolCallIds(calls.map(({ id }) => id))
    try {
      this.run.options.budget.reserveToolCalls(calls.length)
    } catch (error) {
      await this.run.emitBudgetError(error)
      throw error
    }
    const task = this.#scope.spawn(() => this.executeToolBatch(calls))
    this.#children.push(task)
    return task
  }

  async evaluateCompletion(output: ModelOutput): Promise<void> {
    this.ensureOpen()
    if (this.#completionClaimed) {
      throw new ExecutionInvariantError("A Turn can evaluate completion only once")
    }
    if (this.#modelOutput !== output || output.stopReason !== "completed") {
      throw new ExecutionInvariantError("Completion must evaluate this Turn's completed output")
    }
    this.#completionClaimed = true
    const task = this.#scope.spawn(async () => {
      const decision = await runAbortableOperation(this.#scope.signal, () =>
        this.run.options.completionGate.evaluate(
          {
            ...this.context,
            nonterminalItemCount: this.#items.nonterminalItemCount,
            executingAttemptCount: this.#items.executingAttemptCount,
            pendingApprovalCount: this.#items.pendingApprovalCount,
          },
          output,
        ),
      )
      if (decision.type === "blocked") {
        throw new ExecutionBlockedError(decision.reason)
      }
    })
    this.#children.push(task)
    await task
  }

  async close(cancel: boolean, reason?: unknown): Promise<void> {
    if (this.#state === "closed") {
      return
    }
    if (!cancel && this.#modelOutput?.stopReason === "tool_calls" && !this.#toolsClaimed) {
      throw new ExecutionInvariantError(
        "A Tool-call Model output must be executed before Turn close",
      )
    }
    if (!cancel && this.#modelOutput?.stopReason === "completed" && !this.#completionClaimed) {
      throw new ExecutionInvariantError("A completed Model output must pass the CompletionGate")
    }
    this.#state = "closing"
    const result = cancel
      ? await this.#scope.cancelAndJoin({
          reason,
          timeoutMs: this.run.options.budget.budget.cleanupTimeoutMs,
        })
      : await this.#scope.close({
          timeoutMs: this.run.options.budget.budget.cleanupTimeoutMs,
        })
    this.#state = "closed"
    if (result.type === "cleanup_timeout") {
      throw new ExecutionCleanupTimeoutError("turn")
    }
    const settled = await Promise.allSettled(this.#children)
    const failure = settled.find(
      (entry): entry is PromiseRejectedResult => entry.status === "rejected",
    )
    if (failure !== undefined && !cancel) {
      throw failure.reason
    }
  }

  private async executeModelAttempt(
    operation: (context: ExecutionAttemptContext) => Promise<ModelOutput>,
  ): Promise<ModelOutput> {
    const itemId = this.run.createItemId()
    let attempt: ReturnType<ItemRegistry["startAttempt"]> | undefined
    let scope: ReturnType<typeof createAbortScope> | undefined
    try {
      this.run.options.budget.reserveModelCall()
      this.#items.registerModel({ itemId, turnId: this.context.turnId })
      attempt = this.#items.startAttempt(itemId)
      const attemptId = AttemptIdSchema.parse(attempt.record.attemptId)
      const attemptNumber = AttemptNumberSchema.parse(attempt.record.attemptNumber)
      const attemptScope = createAbortScope(
        this.#scope.signal,
        this.run.options.budget.budget.modelTimeoutMs,
        new ExecutionTimeoutError("model"),
      )
      scope = attemptScope
      await this.run.emit({
        type: "model.started",
        turnId: this.context.turnId,
        itemId,
        attemptId,
        attempt: attemptNumber,
      })
      const output = await runAbortable(attemptScope, (signal) =>
        operation({
          ...this.context,
          itemId,
          attemptId,
          attempt: attemptNumber,
          signal,
          deadline: attemptScope.deadline,
        }),
      )
      this.#modelOutput = output
      attempt.complete()
      await this.run.emit({
        type: "model.completed",
        turnId: this.context.turnId,
        itemId,
        attemptId,
        attempt: attemptNumber,
      })
      return output
    } catch (error) {
      if (attempt !== undefined) {
        const current = this.#items.get(itemId)
        if (current?.state === "executing") {
          if (error instanceof ExecutionCancelledError) {
            attempt.cancel()
          } else {
            attempt.fail()
          }
        }
      }
      if (attempt !== undefined) {
        const attemptId = AttemptIdSchema.parse(attempt.record.attemptId)
        const attemptNumber = AttemptNumberSchema.parse(attempt.record.attemptNumber)
        await this.run.emit({
          type: error instanceof ExecutionCancelledError ? "model.cancelled" : "model.failed",
          turnId: this.context.turnId,
          itemId,
          attemptId,
          attempt: attemptNumber,
          ...(error instanceof ExecutionHarnessError
            ? {
                reason: error.message,
                ...(error.outcome.displayReason === undefined
                  ? {}
                  : { displayReason: error.outcome.displayReason }),
                failure: error.failure,
              }
            : {
                reason: "Model execution failed",
                failure: new ExecutionFailedError(error).failure,
              }),
        })
      }
      throw error
    } finally {
      scope?.dispose()
    }
  }

  private async executeToolBatch(calls: readonly ToolCall[]): Promise<readonly ToolResult[]> {
    const results: ToolResult[] = []
    for (const call of calls) {
      results.push(
        await executeToolItem({
          run: this.run,
          context: this.context,
          scope: this.#scope,
          items: this.#items,
          call,
        }),
      )
    }
    return results
  }

  private ensureOpen(): void {
    if (this.#state !== "open") {
      throw new ExecutionInvariantError("A closed Turn cannot start new work")
    }
    this.run.ensureWorkAllowed()
  }
}
