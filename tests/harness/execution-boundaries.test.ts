import { expect, test } from "bun:test"
import {
  type ApprovalBroker,
  type CapabilityPolicy,
  EffectDigestSchema,
  ExecutionApprovalMismatchError,
  ExecutionHarnessError,
  ModelError,
  type Tool,
  type ToolSandbox,
} from "../../src/index.ts"
import { createHarnessFixture, TEST_BUDGET } from "./harness-test-fixtures.ts"

type PathInput = {
  readonly path: string
}

const pathTool: Tool<PathInput> = {
  definition: {
    name: "boundary_path",
    description: "Reads a path for boundary tests",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  capabilities: (input) => [{ type: "filesystem.read", path: input.path }],
  execute: async (input) => ({ success: true, output: input.path }),
}

test("logically terminates a Run when its callback never resolves", async () => {
  // Given
  const started = Promise.withResolvers<void>()
  const { harness, events } = createHarnessFixture({
    budget: { ...TEST_BUDGET, maxRunTimeMs: 20 },
  })

  // When
  const execution = harness.withRun({}, async () => {
    started.resolve()
    return new Promise<string>(() => undefined)
  })
  await started.promise
  let caught: unknown
  try {
    await execution
  } catch (error) {
    caught = error
  }

  // Then
  expect(caught).toBeInstanceOf(ExecutionHarnessError)
  expect(caught).toMatchObject({ outcome: { type: "blocked" } })
  expect(events.events.at(-1)?.type).toBe("run.blocked")
})

test("fails closed when approval resolves for a different prepared effect", async () => {
  // Given
  let executionCount = 0
  const capabilityPolicy: CapabilityPolicy = {
    evaluate: () => ({ type: "ask", reason: "approval required" }),
  }
  const approvalBroker: ApprovalBroker = {
    request: async (request) => ({
      approvalId: request.approvalId,
      effectDigest: EffectDigestSchema.parse("sha256:wrong-effect"),
      status: "approved",
    }),
  }
  const tool: Tool<PathInput> = {
    ...pathTool,
    execute: async (input) => {
      executionCount += 1
      return { success: true, output: input.path }
    },
  }
  const { harness, events } = createHarnessFixture({
    tools: [tool],
    capabilityPolicy,
    approvalBroker,
  })

  // When
  let caught: unknown
  try {
    await harness.withRun({}, (run) =>
      run.withTurn(async (turn) => {
        const output = await turn.executeModel(async () => ({
          stopReason: "tool_calls",
          toolCalls: [
            { id: "approval_mismatch", name: "boundary_path", arguments: { path: "safe" } },
          ],
        }))
        return turn.executeTools(output.toolCalls)
      }),
    )
  } catch (error) {
    caught = error
  }

  // Then
  expect(caught).toBeInstanceOf(ExecutionApprovalMismatchError)
  expect(caught).toMatchObject({ outcome: { type: "failed" } })
  expect(executionCount).toBe(0)
  expect(events.events.some(({ type }) => type === "tool.started")).toBe(false)
  expect(events.events.at(-1)?.type).toBe("run.failed")
})

test("invokes the prepared effect inside the configured sandbox boundary", async () => {
  // Given
  let sandboxCount = 0
  const sandbox: ToolSandbox = {
    execute: async (_prepared, context, invoke) => {
      sandboxCount += 1
      return invoke(context)
    },
  }
  const { harness } = createHarnessFixture({ tools: [pathTool], sandbox })
  const call = {
    id: "sandboxed",
    name: "boundary_path",
    arguments: { path: "safe" },
  } as const
  const output = { stopReason: "tool_calls" as const, toolCalls: [call] as const }

  // When
  const results = await harness.withRun({}, (run) =>
    run.withTurn(async (turn) => {
      await turn.executeModel(async () => ({
        stopReason: "tool_calls",
        toolCalls: output.toolCalls,
      }))
      return turn.executeTools(output.toolCalls)
    }),
  )

  // Then
  expect(results[0]?.output).toBe("safe")
  expect(sandboxCount).toBe(1)
})

test("preserves ModelError retry metadata in the terminal failure", async () => {
  // Given
  const { harness } = createHarnessFixture()

  // When
  let caught: unknown
  try {
    await harness.withRun({}, (run) =>
      run.withTurn((turn) =>
        turn.executeModel(async () => {
          throw new ModelError({
            kind: "rate_limit",
            message: "provider throttled",
            retryable: true,
          })
        }),
      ),
    )
  } catch (error) {
    caught = error
  }

  // Then
  expect(caught).toMatchObject({
    outcome: {
      type: "failed",
      failure: { kind: "model", retryable: true },
    },
  })
})
