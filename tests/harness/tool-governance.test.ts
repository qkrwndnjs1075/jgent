import { expect, jest, test } from "bun:test"
import type {
  ApprovalBroker,
  ApprovalRequest,
  ApprovalResult,
  Capability,
  CapabilityPolicy,
  Tool,
  ToolCall,
} from "../../src/index.ts"
import { ExecutionHarnessError } from "../../src/index.ts"
import { createHarnessFixture, TEST_BUDGET, TestInvariantError } from "./harness-test-fixtures.ts"

type PathInput = {
  readonly path: string
}

function createPathTool(observations: {
  capabilities: string[]
  executions: string[]
}): Tool<PathInput> {
  return {
    definition: {
      name: "path_tool",
      description: "Observes a path",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
    capabilities: (input) => {
      observations.capabilities.push(input.path)
      return [{ type: "filesystem.read", path: input.path }]
    },
    execute: async (input) => {
      observations.executions.push(input.path)
      return { success: true, output: input.path }
    },
  }
}

test("does not authorize invalid Tool arguments", async () => {
  // Given
  const observations = { capabilities: [] as string[], executions: [] as string[] }
  let policyCount = 0
  const capabilityPolicy: CapabilityPolicy = {
    evaluate: () => {
      policyCount += 1
      return { type: "allow" }
    },
  }
  const { harness } = createHarnessFixture({
    tools: [createPathTool(observations)],
    capabilityPolicy,
  })

  // When
  const results = await harness.withRun({}, (run) =>
    run.withTurn(async (turn) => {
      const output = await turn.executeModel(async () => ({
        stopReason: "tool_calls",
        toolCalls: [{ id: "invalid", name: "path_tool", arguments: { value: 1 } }],
      }))
      return turn.executeTools(output.toolCalls)
    }),
  )

  // Then
  expect(results[0]?.success).toBe(false)
  expect(observations.capabilities).toEqual([])
  expect(observations.executions).toEqual([])
  expect(policyCount).toBe(0)
})

test("returns a correlated denial without approval or execution", async () => {
  // Given
  const observations = { capabilities: [] as string[], executions: [] as string[] }
  const capabilityPolicy: CapabilityPolicy = {
    evaluate: () => ({ type: "deny", reason: "approved /secret/path" }),
  }
  const { harness, events } = createHarnessFixture({
    tools: [createPathTool(observations)],
    capabilityPolicy,
  })

  // When
  const results = await harness.withRun({}, (run) =>
    run.withTurn(async (turn) => {
      const output = await turn.executeModel(async () => ({
        stopReason: "tool_calls",
        toolCalls: [{ id: "denied", name: "path_tool", arguments: { path: "before" } }],
      }))
      return turn.executeTools(output.toolCalls)
    }),
  )

  // Then
  expect(results).toEqual([
    {
      toolCallId: "denied",
      success: false,
      output: "",
      error: "Tool denied: approved /secret/path",
    },
  ])
  expect(observations.executions).toEqual([])
  expect(events.events.some(({ type }) => type === "tool.started")).toBe(false)
  expect(JSON.stringify(events.events)).not.toContain("/secret/path")
})

test("closes the Tool Item when CapabilityPolicy throws", async () => {
  // Given
  const observations = { capabilities: [] as string[], executions: [] as string[] }
  const { harness, events } = createHarnessFixture({
    tools: [createPathTool(observations)],
    capabilityPolicy: {
      evaluate: () => {
        throw new TestInvariantError("policy failed")
      },
    },
  })

  // When
  let caught: unknown
  try {
    await harness.withRun({}, (run) =>
      run.withTurn(async (turn) => {
        const output = await turn.executeModel(async () => ({
          stopReason: "tool_calls",
          toolCalls: [{ id: "policy_error", name: "path_tool", arguments: { path: "before" } }],
        }))
        return turn.executeTools(output.toolCalls)
      }),
    )
  } catch (error) {
    if (error instanceof ExecutionHarnessError) {
      caught = error
    } else {
      throw error
    }
  }

  // Then
  expect(caught).toMatchObject({ outcome: { type: "failed" } })
  const eventTypes = events.events.map(({ type }) => type)
  expect(eventTypes).toContain("tool.requested")
  expect(eventTypes).toContain("tool.failed")
  expect(eventTypes).toContain("turn.failed")
  expect(eventTypes).toContain("run.failed")
  expect(observations.executions).toEqual([])
})

test("executes the approved prepared effect without input mutation changing it", async () => {
  // Given
  const observations = { capabilities: [] as string[], executions: [] as string[] }
  const approvalStarted = Promise.withResolvers<void>()
  const approvalDecision = Promise.withResolvers<ApprovalResult>()
  let pendingApproval: ApprovalRequest | undefined
  const approvalBroker: ApprovalBroker = {
    request: async (request) => {
      pendingApproval = request
      approvalStarted.resolve()
      return approvalDecision.promise
    },
  }
  const capabilityPolicy: CapabilityPolicy = {
    evaluate: (request) => ({ type: "ask", reason: describeCapabilities(request.capabilities) }),
  }
  const { harness, events } = createHarnessFixture({
    tools: [createPathTool(observations)],
    capabilityPolicy,
    approvalBroker,
  })
  const argumentsValue = { path: "before" }
  const call: ToolCall = { id: "approved", name: "path_tool", arguments: argumentsValue }

  // When
  const execution = harness.withRun({}, (run) =>
    run.withTurn(async (turn) => {
      const output = await turn.executeModel(async () => ({
        stopReason: "tool_calls",
        toolCalls: [call],
      }))
      return turn.executeTools(output.toolCalls)
    }),
  )
  await approvalStarted.promise
  argumentsValue.path = "after"
  if (pendingApproval === undefined) {
    throw new TestInvariantError("Expected a pending approval")
  }
  approvalDecision.resolve({
    approvalId: pendingApproval.approvalId,
    effectDigest: pendingApproval.effectDigest,
    status: "approved",
  })
  const results = await execution

  // Then
  expect(results[0]).toMatchObject({ success: true, output: "before" })
  expect(observations.capabilities).toEqual(["before"])
  expect(observations.executions).toEqual(["before"])
  const eventTypes = events.events.map(({ type }) => type)
  expect(eventTypes).toContain("approval.requested")
  expect(eventTypes).toContain("approval.resolved")
  expect(eventTypes).toContain("tool.started")
})

test("expires an unresolved approval within its configured bound", async () => {
  // Given
  jest.useFakeTimers()
  const observations = { capabilities: [] as string[], executions: [] as string[] }
  const approvalStarted = Promise.withResolvers<void>()
  const approvalBroker: ApprovalBroker = {
    request: (request, signal) => {
      approvalStarted.resolve()
      return new Promise((resolve) => {
        signal.addEventListener(
          "abort",
          () =>
            resolve({
              approvalId: request.approvalId,
              effectDigest: request.effectDigest,
              status: "cancelled",
            }),
          { once: true },
        )
      })
    },
  }
  const capabilityPolicy: CapabilityPolicy = {
    evaluate: () => ({ type: "ask", reason: "approval required" }),
  }
  const { harness } = createHarnessFixture({
    tools: [createPathTool(observations)],
    capabilityPolicy,
    approvalBroker,
    budget: { ...TEST_BUDGET, approvalTimeoutMs: 25 },
  })

  try {
    // When
    const execution = harness.withRun({}, (run) =>
      run.withTurn(async (turn) => {
        const output = await turn.executeModel(async () => ({
          stopReason: "tool_calls",
          toolCalls: [{ id: "expires", name: "path_tool", arguments: { path: "before" } }],
        }))
        return turn.executeTools(output.toolCalls)
      }),
    )
    await approvalStarted.promise
    jest.advanceTimersByTime(25)
    const results = await execution

    // Then
    expect(results[0]).toMatchObject({
      toolCallId: "expires",
      success: false,
      error: "Tool approval expired",
    })
    expect(observations.executions).toEqual([])
  } finally {
    jest.useRealTimers()
  }
})

test("returns a correlated failure when Tool execution exceeds its timeout", async () => {
  // Given
  jest.useFakeTimers()
  const started = Promise.withResolvers<void>()
  const tool: Tool<PathInput> = {
    ...createPathTool({ capabilities: [], executions: [] }),
    execute: async (_input, { signal }) =>
      new Promise((resolve) => {
        started.resolve()
        signal.addEventListener("abort", () => resolve({ success: true, output: "late success" }), {
          once: true,
        })
      }),
  }
  const { harness, events } = createHarnessFixture({
    tools: [tool],
    budget: { ...TEST_BUDGET, toolTimeoutMs: 25 },
  })

  try {
    // When
    const execution = harness.withRun({}, (run) =>
      run.withTurn(async (turn) => {
        const output = await turn.executeModel(async () => ({
          stopReason: "tool_calls",
          toolCalls: [{ id: "timeout", name: "path_tool", arguments: { path: "before" } }],
        }))
        return turn.executeTools(output.toolCalls)
      }),
    )
    await started.promise
    jest.advanceTimersByTime(25)
    const results = await execution

    // Then
    expect(results[0]).toEqual({
      toolCallId: "timeout",
      success: false,
      output: "",
      error: "Tool execution timed out",
    })
    expect(events.events.at(-1)?.type).toBe("run.completed")
  } finally {
    jest.useRealTimers()
  }
})

test("fails within the cleanup bound when a Tool ignores cancellation", async () => {
  // Given
  jest.useFakeTimers()
  const started = Promise.withResolvers<void>()
  const tool: Tool<PathInput> = {
    ...createPathTool({ capabilities: [], executions: [] }),
    execute: async () => {
      started.resolve()
      return new Promise(() => {})
    },
  }
  const { harness, events } = createHarnessFixture({
    tools: [tool],
    budget: { ...TEST_BUDGET, toolTimeoutMs: 25, cleanupTimeoutMs: 10 },
  })

  try {
    // When
    const execution = harness.withRun({}, (run) =>
      run.withTurn(async (turn) => {
        const output = await turn.executeModel(async () => ({
          stopReason: "tool_calls",
          toolCalls: [{ id: "ignores_abort", name: "path_tool", arguments: { path: "before" } }],
        }))
        return turn.executeTools(output.toolCalls)
      }),
    )
    await started.promise
    jest.advanceTimersByTime(25)
    await Promise.resolve()
    await Promise.resolve()
    jest.advanceTimersByTime(10)
    let caught: unknown
    try {
      await execution
    } catch (error) {
      if (error instanceof ExecutionHarnessError) {
        caught = error
      } else {
        throw error
      }
    }

    // Then
    expect(caught).toMatchObject({
      outcome: { type: "failed", reason: "ToolCleanupTimeout" },
    })
    expect(events.events.at(-1)?.type).toBe("run.failed")
  } finally {
    jest.useRealTimers()
  }
})

function describeCapabilities(capabilities: readonly Capability[]): string {
  const first = capabilities[0]
  if (first?.type === "filesystem.read") {
    return `read ${first.path}`
  }
  throw new TestInvariantError("Expected a filesystem.read capability")
}
