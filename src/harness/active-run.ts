import { randomUUID } from "node:crypto"
import type { ToolDefinition } from "../core/index.ts"
import type { ToolRuntime } from "../tool/index.ts"
import { type AbortScope, abortReason, runAbortableOperation } from "./abort-scope.ts"
import { ActiveTurn } from "./active-turn.ts"
import type { BudgetTracker } from "./budget-tracker.ts"
import {
  type ApprovalBroker,
  type CapabilityPolicy,
  type CompletionGate,
  type ItemId,
  ItemIdSchema,
  type RunContext,
  type RunExecution,
  type RunOutcome,
  type ToolSandbox,
  TurnIdSchema,
} from "./contracts.ts"
import {
  ExecutionBudgetExceededError,
  ExecutionCleanupTimeoutError,
  ExecutionEventSinkError,
  ExecutionFailedError,
  ExecutionHarnessError,
  ExecutionInvariantError,
} from "./errors.ts"
import type { EventWriter, HarnessEventDetails } from "./event-writer.ts"
import { ExecutionScope } from "./execution-scope.ts"
import type { ItemRegistry } from "./item-registry.ts"
import { closeRunForFailure } from "./run-cleanup.ts"
import { terminalDetails } from "./run-terminal.ts"

export type ActiveRunOptions = {
  readonly context: RunContext
  readonly exposedTools: readonly ToolDefinition[]
  readonly abortScope: AbortScope
  readonly scope: ExecutionScope
  readonly items: ItemRegistry
  readonly budget: BudgetTracker
  readonly events: EventWriter
  readonly toolRuntime: ToolRuntime
  readonly capabilityPolicy: CapabilityPolicy
  readonly approvalBroker: ApprovalBroker
  readonly completionGate: CompletionGate
  readonly sandbox: ToolSandbox
}

export class ActiveRun implements RunExecution {
  readonly context: RunContext
  readonly exposedTools: readonly ToolDefinition[]
  readonly options: ActiveRunOptions
  readonly items: ItemRegistry
  #turnActive = false
  #state: "open" | "closing" | "closed" = "open"
  #outcome: RunOutcome | undefined
  readonly #toolCallIds = new Set<string>()
  readonly #turns: Promise<unknown>[] = []

  constructor(options: ActiveRunOptions) {
    this.options = options
    this.context = options.context
    this.exposedTools = options.exposedTools
    this.items = options.items
  }

  async execute<T>(operation: (run: RunExecution) => Promise<T>): Promise<T> {
    try {
      await this.emit({ type: "run.started" })
      const result = await runAbortableOperation(this.context.signal, () => operation(this))
      await this.closeChildren(false)
      this.ensureSignalActive()
      const outcome: RunOutcome = { type: "completed" }
      this.decideOutcome(outcome)
      await this.deliverTerminal(outcome)
      return result
    } catch (error) {
      if (this.#outcome !== undefined) {
        throw error
      }
      const executionError = this.normalizeError(error)
      this.#state = "closing"
      const cleanupError = await closeRunForFailure(this)
      const terminalError = cleanupError ?? executionError
      this.decideOutcome(terminalError.outcome)
      await this.deliverTerminal(terminalError.outcome)
      throw terminalError
    } finally {
      this.#state = "closed"
      this.options.abortScope.dispose()
    }
  }

  async withTurn<T>(operation: (turn: ActiveTurn) => Promise<T>): Promise<T> {
    this.ensureOpen()
    if (this.#turnActive) {
      throw new ExecutionInvariantError("A Run cannot execute overlapping Turns")
    }

    let turnIndex: number
    try {
      turnIndex = this.options.budget.reserveTurn()
    } catch (error) {
      await this.emitBudgetError(error)
      throw error
    }

    this.#turnActive = true
    const context = {
      ...this.context,
      signal: this.options.scope.signal,
      turnId: TurnIdSchema.parse(randomUUID()),
      index: turnIndex,
    }

    const turn = new ActiveTurn(
      this,
      context,
      new ExecutionScope({
        parent: context.signal,
        cleanupTimeoutMs: this.options.budget.budget.cleanupTimeoutMs,
      }),
      this.items,
    )
    const task = this.options.scope.spawn(() => this.executeTurn(turn, operation))
    this.#turns.push(task)
    return task
  }

  createItemId(): ItemId {
    return ItemIdSchema.parse(randomUUID())
  }

  claimToolCallIds(ids: readonly string[]): void {
    const batchIds = new Set<string>()
    for (const id of ids) {
      if (batchIds.has(id) || this.#toolCallIds.has(id)) {
        throw new ExecutionInvariantError(`Duplicate provider Tool-call id: ${id}`)
      }
      batchIds.add(id)
    }
    for (const id of batchIds) {
      this.#toolCallIds.add(id)
    }
  }

  ensureSignalActive(): void {
    if (this.context.signal.aborted) {
      throw abortReason(this.context.signal)
    }
  }

  ensureWorkAllowed(): void {
    this.ensureOpen()
  }

  async emit(details: HarnessEventDetails): Promise<void> {
    await this.options.events.emit(details, this.context.signal)
  }

  async emitBudgetError(error: unknown): Promise<void> {
    if (error instanceof ExecutionBudgetExceededError) {
      await this.emit({ type: "budget.exceeded", resource: error.resource })
    }
  }

  private ensureOpen(): void {
    if (this.#state !== "open" || this.#outcome !== undefined) {
      throw new ExecutionInvariantError("A closed Run cannot start new work")
    }
    this.ensureSignalActive()
  }

  private async executeTurn<T>(
    turn: ActiveTurn,
    operation: (turn: ActiveTurn) => Promise<T>,
  ): Promise<T> {
    try {
      await this.emit({ type: "turn.started", turnId: turn.context.turnId })
      const result = await runAbortableOperation(turn.context.signal, () => operation(turn))
      await turn.close(false)
      this.ensureSignalActive()
      await this.emit({ type: "turn.completed", turnId: turn.context.turnId })
      return result
    } catch (error) {
      let closeError: unknown
      try {
        await turn.close(true, error)
      } catch (cleanupError) {
        closeError = cleanupError
      }
      if (this.context.signal.aborted) {
        await this.emit({
          type: "turn.cancelled",
          turnId: turn.context.turnId,
          ...(error instanceof ExecutionHarnessError
            ? {
                reason: error.outcome.reason ?? error.message,
                ...(error.outcome.displayReason === undefined
                  ? {}
                  : { displayReason: error.outcome.displayReason }),
                failure: error.failure,
              }
            : {}),
        })
      } else {
        const failure =
          error instanceof ExecutionHarnessError
            ? error.failure
            : new ExecutionFailedError(error).failure
        await this.emit({
          type: "turn.failed",
          turnId: turn.context.turnId,
          reason: error instanceof Error ? error.message : "Turn execution failed",
          failure,
        })
      }
      throw closeError ?? error
    } finally {
      this.#turnActive = false
    }
  }

  private async closeChildren(cancel: boolean): Promise<void> {
    this.#state = "closing"
    const result = cancel
      ? await this.options.scope.cancelAndJoin({
          reason: abortReason(this.context.signal),
          timeoutMs: this.options.budget.budget.cleanupTimeoutMs,
        })
      : await this.options.scope.close({
          timeoutMs: this.options.budget.budget.cleanupTimeoutMs,
        })
    if (result.type === "cleanup_timeout") {
      throw new ExecutionCleanupTimeoutError("run")
    }
    const settled = await Promise.allSettled(this.#turns)
    const failure = settled.find(
      (entry): entry is PromiseRejectedResult => entry.status === "rejected",
    )
    if (failure !== undefined) {
      throw failure.reason
    }
  }

  private decideOutcome(outcome: RunOutcome): boolean {
    if (this.#outcome !== undefined) {
      return false
    }
    if (outcome.type === "completed" && (this.#turnActive || this.items.nonterminalItemCount > 0)) {
      throw new ExecutionInvariantError("A Run cannot complete with active execution work")
    }
    this.#outcome = outcome
    return true
  }

  private async deliverTerminal(outcome: RunOutcome): Promise<void> {
    const delivery = await this.options.events.emitTerminal(terminalDetails(outcome))
    if (delivery.status === "failed") {
      throw new ExecutionEventSinkError(delivery.failure, outcome, delivery)
    }
  }

  private normalizeError(error: unknown): ExecutionHarnessError {
    if (this.context.signal.aborted) {
      const reason = abortReason(this.context.signal)
      return reason instanceof ExecutionHarnessError ? reason : new ExecutionFailedError(reason)
    }
    if (error instanceof ExecutionHarnessError) {
      return error
    }
    return new ExecutionFailedError(error)
  }
}
