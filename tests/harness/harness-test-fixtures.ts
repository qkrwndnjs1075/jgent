import {
  AjvToolValidator,
  type ApprovalBroker,
  type CapabilityPolicy,
  type CompletionGate,
  type EventSink,
  type ExecutionBudget,
  ExecutionHarness,
  type HarnessEvent,
  InMemoryToolRegistry,
  type Tool,
  type ToolExposurePolicy,
  ToolRuntime,
  type ToolSandbox,
} from "../../src/index.ts"

export const TEST_BUDGET = {
  maxTurns: 4,
  maxModelCalls: 4,
  maxToolCalls: 8,
  maxRunTimeMs: 10_000,
  modelTimeoutMs: 5_000,
  toolTimeoutMs: 5_000,
  approvalTimeoutMs: 5_000,
  cleanupTimeoutMs: 1_000,
} satisfies ExecutionBudget

export class TestInvariantError extends Error {
  readonly name = "TestInvariantError"
}

export class RecordingEventSink implements EventSink {
  readonly events: HarnessEvent[] = []

  async emit(event: HarnessEvent): Promise<void> {
    this.events.push(event)
  }
}

export const ALLOW_ALL_POLICY: CapabilityPolicy = {
  evaluate: () => ({ type: "allow" }),
}

export const PASS_THROUGH_EXPOSURE: ToolExposurePolicy = {
  filter: (tools) => tools,
}

export const UNEXPECTED_APPROVAL: ApprovalBroker = {
  request: () => {
    throw new TestInvariantError("Approval was not expected")
  },
}

type HarnessFixtureOptions<TInput extends object> = {
  readonly tools?: readonly Tool<TInput>[]
  readonly budget?: ExecutionBudget
  readonly capabilityPolicy?: CapabilityPolicy
  readonly approvalBroker?: ApprovalBroker
  readonly exposurePolicy?: ToolExposurePolicy
  readonly completionGate?: CompletionGate
  readonly eventSink?: EventSink
  readonly sandbox?: ToolSandbox
}

export function createHarnessFixture<TInput extends object = Record<string, never>>(
  options: HarnessFixtureOptions<TInput> = {},
): {
  readonly harness: ExecutionHarness
  readonly events: RecordingEventSink
} {
  const registry = new InMemoryToolRegistry()
  const tools = options.tools ?? []
  for (const tool of tools) {
    registry.register(tool)
  }
  const events = new RecordingEventSink()

  return {
    harness: new ExecutionHarness({
      tools: tools.map(({ definition }) => definition),
      toolRuntime: new ToolRuntime(registry, new AjvToolValidator()),
      budget: options.budget ?? TEST_BUDGET,
      eventSink: options.eventSink ?? events,
      exposurePolicy: options.exposurePolicy ?? PASS_THROUGH_EXPOSURE,
      capabilityPolicy: options.capabilityPolicy ?? ALLOW_ALL_POLICY,
      approvalBroker: options.approvalBroker ?? UNEXPECTED_APPROVAL,
      ...(options.completionGate === undefined ? {} : { completionGate: options.completionGate }),
      ...(options.sandbox === undefined ? {} : { sandbox: options.sandbox }),
    }),
    events,
  }
}
