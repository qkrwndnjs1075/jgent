import { randomUUID } from "node:crypto"
import type { ToolDefinition } from "../core/index.ts"
import type { ToolRuntime } from "../tool/index.ts"
import { createAbortScope } from "./abort-scope.ts"
import { ActiveRun } from "./active-run.ts"
import { BudgetTracker } from "./budget-tracker.ts"
import {
  type ApprovalBroker,
  type CapabilityPolicy,
  type CompletionContext,
  type CompletionGate,
  type EventSink,
  type ExecutionBudget,
  type RunExecution,
  RunIdSchema,
  type StartRunInput,
  type ToolExposurePolicy,
  type ToolSandbox,
} from "./contracts.ts"
import { ExecutionInvariantError, ExecutionTimeoutError } from "./errors.ts"
import { EventWriter } from "./event-writer.ts"
import { ExecutionScope } from "./execution-scope.ts"
import { ItemRegistry } from "./item-registry.ts"

export type ExecutionHarnessOptions = {
  readonly tools: readonly ToolDefinition[]
  readonly toolRuntime: ToolRuntime
  readonly budget: ExecutionBudget
  readonly eventSink: EventSink
  readonly exposurePolicy: ToolExposurePolicy
  readonly capabilityPolicy: CapabilityPolicy
  readonly approvalBroker: ApprovalBroker
  readonly completionGate?: CompletionGate
  readonly sandbox?: ToolSandbox
}

export class ExecutionHarness {
  readonly #budget: ExecutionBudget

  constructor(private readonly options: ExecutionHarnessOptions) {
    this.#budget = new BudgetTracker(options.budget).budget
    validateToolCatalog(options.tools, options.toolRuntime)
  }

  async withRun<T>(input: StartRunInput, operation: (run: RunExecution) => Promise<T>): Promise<T> {
    const runId = RunIdSchema.parse(randomUUID())
    const abortScope = createAbortScope(
      input.signal,
      this.#budget.maxRunTimeMs,
      new ExecutionTimeoutError("run"),
    )
    const runContext = { runId, signal: abortScope.signal }
    const scope = new ExecutionScope({
      parent: abortScope.signal,
      cleanupTimeoutMs: this.#budget.cleanupTimeoutMs,
    })
    try {
      const sourceSnapshot = immutableToolSnapshot(this.options.tools)
      const exposedTools = immutableToolSnapshot(
        validateExposure(
          this.options.exposurePolicy.filter(sourceSnapshot, runContext),
          sourceSnapshot,
        ),
      )
      const run = new ActiveRun({
        context: runContext,
        exposedTools,
        abortScope,
        scope,
        items: new ItemRegistry(),
        budget: new BudgetTracker(this.#budget),
        events: new EventWriter(
          runId,
          this.options.eventSink,
          Date.now,
          this.#budget.cleanupTimeoutMs,
        ),
        toolRuntime: this.options.toolRuntime,
        capabilityPolicy: this.options.capabilityPolicy,
        approvalBroker: this.options.approvalBroker,
        completionGate: this.options.completionGate ?? new SettledCompletionGate(),
        sandbox: this.options.sandbox ?? PASSTHROUGH_SANDBOX,
      })
      return await run.execute(operation)
    } catch (error) {
      abortScope.dispose()
      throw error
    }
  }
}

const PASSTHROUGH_SANDBOX: ToolSandbox = {
  execute: (_prepared, context, invoke) => invoke(context),
}

function validateToolCatalog(tools: readonly ToolDefinition[], runtime: ToolRuntime): void {
  const names = new Set<string>()
  for (const tool of tools) {
    if (names.has(tool.name)) {
      throw new ExecutionInvariantError(`Duplicate Tool definition: ${tool.name}`)
    }
    if (!runtime.has(tool.name)) {
      throw new ExecutionInvariantError(`Tool definition is not registered: ${tool.name}`)
    }
    names.add(tool.name)
  }
}

function validateExposure(
  exposedTools: readonly ToolDefinition[],
  sourceTools: readonly ToolDefinition[],
): readonly ToolDefinition[] {
  const sourceNames = new Set(sourceTools.map(({ name }) => name))
  const exposedNames = new Set<string>()
  for (const tool of exposedTools) {
    if (!sourceNames.has(tool.name)) {
      throw new ExecutionInvariantError(`Exposure returned an unregistered Tool: ${tool.name}`)
    }
    if (exposedNames.has(tool.name)) {
      throw new ExecutionInvariantError(`Exposure returned a duplicate Tool: ${tool.name}`)
    }
    exposedNames.add(tool.name)
  }
  return exposedTools
}

function immutableToolSnapshot(tools: readonly ToolDefinition[]): readonly ToolDefinition[] {
  return deepFreeze(tools.map((tool) => structuredClone(tool)))
}

function deepFreeze<T extends object>(value: T): T {
  for (const nested of Object.values(value)) {
    if (typeof nested === "object" && nested !== null && !Object.isFrozen(nested)) {
      deepFreeze(nested)
    }
  }
  return Object.freeze(value)
}

class SettledCompletionGate implements CompletionGate {
  async evaluate(context: CompletionContext) {
    return context.nonterminalItemCount === 0 &&
      context.executingAttemptCount === 0 &&
      context.pendingApprovalCount === 0
      ? ({ type: "accept" } as const)
      : ({ type: "blocked", reason: "Run has pending execution work" } as const)
  }
}
