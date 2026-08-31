import type {
  ExecutionBudgetResource,
  ExecutionFailure,
  ExecutionFailureKind,
  ExecutionFailureScope,
  RunOutcome,
  TerminalEventDelivery,
} from "./contracts.ts"

type FailureOptions = {
  readonly retryable?: boolean
  readonly scope?: ExecutionFailureScope
  readonly resource?: ExecutionBudgetResource
}

export class ExecutionHarnessError extends Error {
  readonly name: string = "ExecutionHarnessError"
  readonly failure: ExecutionFailure
  readonly terminalDelivery: TerminalEventDelivery | undefined

  constructor(
    message: string,
    readonly outcome: RunOutcome,
    options?: ErrorOptions,
    terminalDelivery?: TerminalEventDelivery,
    failureOverride?: ExecutionFailure,
  ) {
    super(message, options)
    this.failure =
      failureOverride ?? outcome.failure ?? createFailure("execution", message, message)
    this.terminalDelivery = terminalDelivery
  }
}

export class ExecutionBudgetExceededError extends ExecutionHarnessError {
  readonly name = "ExecutionBudgetExceededError"

  constructor(
    readonly resource: ExecutionBudgetResource,
    readonly consumed: number,
    readonly requested: number,
    readonly limit: number,
  ) {
    const message = `Execution budget exceeded for ${resource}`
    const failure = createFailure("budget_exceeded", message, message, { resource })
    super(message, { type: "blocked", reason: message, displayReason: message, failure })
  }
}

export class ExecutionCancelledError extends ExecutionHarnessError {
  readonly name = "ExecutionCancelledError"

  constructor() {
    const message = "Execution cancelled"
    const failure = createFailure("cancelled", message, message, { scope: "run" })
    super(message, { type: "cancelled", reason: message, displayReason: message, failure })
  }
}

export class ExecutionTimeoutError extends ExecutionHarnessError {
  readonly name = "ExecutionTimeoutError"

  constructor(readonly scope: ExecutionFailureScope) {
    const message = `${scope} execution timed out`
    const displayReason = scope === "run" ? "Run time budget exceeded" : message
    const failure = createFailure("timeout", message, displayReason, { scope })
    super(
      message,
      scope === "run"
        ? { type: "blocked", reason: displayReason, displayReason, failure }
        : { type: "failed", reason: displayReason, displayReason, failure },
    )
  }
}

export class ExecutionBlockedError extends ExecutionHarnessError {
  readonly name = "ExecutionBlockedError"

  constructor(reason: string) {
    const failure = createFailure("blocked", reason, reason)
    super(reason, { type: "blocked", reason, displayReason: reason, failure })
  }
}

export class ExecutionFailedError extends ExecutionHarnessError {
  readonly name = "ExecutionFailedError"

  constructor(error: unknown) {
    const failure = failureFrom(error)
    const reason = failure.displayReason
    super(
      "Execution failed",
      { type: "failed", reason, displayReason: reason, failure },
      {
        cause: error,
      },
    )
  }
}

export class ExecutionEventSinkError extends ExecutionHarnessError {
  readonly name = "ExecutionEventSinkError"

  constructor(error: unknown, outcome?: RunOutcome, terminalDelivery?: TerminalEventDelivery) {
    const reason = "EventSinkFailure"
    const failure = createFailure("event_sink", "EventSink failed", reason)
    super(
      "EventSink failed",
      outcome ?? { type: "failed", reason, displayReason: reason, failure },
      { cause: error },
      terminalDelivery,
      failure,
    )
  }
}

export class ExecutionCleanupTimeoutError extends ExecutionHarnessError {
  readonly name = "ExecutionCleanupTimeoutError"

  constructor(scope: ExecutionFailureScope = "tool") {
    const reason = scope === "tool" ? "ToolCleanupTimeout" : `${scope}CleanupTimeout`
    const failure = createFailure("cleanup_timeout", "Tool cleanup timed out", reason, {
      scope,
    })
    super("Tool cleanup timed out", { type: "failed", reason, displayReason: reason, failure })
  }
}

export class InvalidExecutionBudgetError extends Error {
  readonly name = "InvalidExecutionBudgetError"

  constructor(readonly field: string) {
    super(`Execution budget field "${field}" must be a positive integer`)
  }
}

export class ExecutionInvariantError extends Error {
  readonly name = "ExecutionInvariantError"
}

export class ExecutionApprovalMismatchError extends ExecutionHarnessError {
  readonly name = "ExecutionApprovalMismatchError"

  constructor(
    readonly approvalId: string,
    readonly expectedEffectDigest: string,
  ) {
    const reason = "Approval effect digest mismatch"
    const failure = createFailure("approval", reason, reason, { scope: "approval" })
    super(reason, { type: "failed", reason, displayReason: reason, failure })
  }
}

function createFailure(
  kind: ExecutionFailureKind,
  message: string,
  displayReason: string,
  options: FailureOptions = {},
): ExecutionFailure {
  return {
    kind,
    message,
    displayReason,
    retryable: options.retryable ?? false,
    ...(options.scope === undefined ? {} : { scope: options.scope }),
    ...(options.resource === undefined ? {} : { resource: options.resource }),
  }
}

function failureName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownFailure"
}

function failureFrom(error: unknown): ExecutionFailure {
  if (
    error instanceof Error &&
    error.name === "ModelError" &&
    "kind" in error &&
    "retryable" in error &&
    typeof error.kind === "string" &&
    typeof error.retryable === "boolean"
  ) {
    return createFailure("model", error.message, error.message, {
      retryable: error.retryable,
      scope: "model",
    })
  }
  const reason = failureName(error)
  return createFailure("execution", "Execution failed", reason)
}
