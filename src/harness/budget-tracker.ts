import type { ExecutionBudget, ExecutionBudgetResource } from "./contracts.ts"
import { ExecutionBudgetExceededError, InvalidExecutionBudgetError } from "./errors.ts"

type BudgetCounters = {
  turns: number
  modelCalls: number
  toolCalls: number
}

export class BudgetTracker {
  readonly budget: ExecutionBudget
  readonly #counters: BudgetCounters = {
    turns: 0,
    modelCalls: 0,
    toolCalls: 0,
  }

  constructor(budget: ExecutionBudget) {
    validateBudget(budget)
    this.budget = Object.freeze({ ...budget })
  }

  reserveTurn(): number {
    this.reserve("turns", this.#counters.turns, 1, this.budget.maxTurns)
    this.#counters.turns += 1
    return this.#counters.turns
  }

  reserveModelCall(): void {
    this.reserve("model_calls", this.#counters.modelCalls, 1, this.budget.maxModelCalls)
    this.#counters.modelCalls += 1
  }

  reserveToolCalls(requested: number): void {
    this.reserve("tool_calls", this.#counters.toolCalls, requested, this.budget.maxToolCalls)
    this.#counters.toolCalls += requested
  }

  private reserve(
    resource: ExecutionBudgetResource,
    consumed: number,
    requested: number,
    limit: number,
  ): void {
    if (consumed + requested > limit) {
      throw new ExecutionBudgetExceededError(resource, consumed, requested, limit)
    }
  }
}

function validateBudget(budget: ExecutionBudget): void {
  for (const [field, value] of Object.entries(budget)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new InvalidExecutionBudgetError(field)
    }
  }
}
