import { randomUUID } from "node:crypto"
import type { ToolCall } from "../core/index.ts"
import type { PreparedToolCall } from "../tool/index.ts"
import { createAbortScope, runAbortable, waitForSettlement } from "./abort-scope.ts"
import type { ActiveRun } from "./active-run.ts"
import {
  ApprovalIdSchema,
  type ApprovalRequest,
  type ApprovalResult,
  type EffectDigest,
  EffectDigestSchema,
  type ItemId,
  type TurnContext,
} from "./contracts.ts"
import {
  ExecutionApprovalMismatchError,
  ExecutionCleanupTimeoutError,
  ExecutionTimeoutError,
} from "./errors.ts"

export type ApprovalExecutionInput = {
  readonly run: ActiveRun
  readonly context: TurnContext
  readonly itemId: ItemId
  readonly call: ToolCall
  readonly prepared: PreparedToolCall
  readonly reason: string
}

export async function requestApproval(input: ApprovalExecutionInput): Promise<ApprovalResult> {
  const approvalId = ApprovalIdSchema.parse(randomUUID())
  const effectDigest = EffectDigestSchema.parse(input.prepared.effectDigest)
  const scope = createAbortScope(
    input.context.signal,
    input.run.options.budget.budget.approvalTimeoutMs,
    new ExecutionTimeoutError("approval"),
  )
  let requested = false
  let brokerExecution: Promise<ApprovalResult> | undefined

  try {
    await input.run.emit({
      type: "approval.requested",
      turnId: input.context.turnId,
      itemId: input.itemId,
      approvalId,
      effectDigest,
      toolCallId: input.call.id,
      toolName: input.prepared.toolIdentity.name ?? input.call.name,
    })
    requested = true
    const result = await runAbortable(scope, (signal) => {
      brokerExecution = input.run.options.approvalBroker.request(
        approvalRequest(input, approvalId, effectDigest),
        signal,
      )
      return brokerExecution
    })
    if (result.approvalId !== approvalId || result.effectDigest !== effectDigest) {
      throw new ExecutionApprovalMismatchError(approvalId, effectDigest)
    }
    await input.run.emit({
      type: "approval.resolved",
      turnId: input.context.turnId,
      itemId: input.itemId,
      approvalId,
      effectDigest,
      approvalStatus: result.status,
      toolCallId: input.call.id,
      toolName: input.prepared.toolIdentity.name ?? input.call.name,
    })
    return result
  } catch (error) {
    if (brokerExecution !== undefined && scope.signal.aborted) {
      const settled = await waitForSettlement(
        brokerExecution,
        input.run.options.budget.budget.cleanupTimeoutMs,
      )
      if (!settled) {
        throw new ExecutionCleanupTimeoutError("approval")
      }
    }
    if (error instanceof ExecutionTimeoutError && error.scope === "approval") {
      const result: ApprovalResult = {
        approvalId,
        effectDigest,
        status: "expired",
      }
      await emitResolution(input, result)
      return result
    }
    if (requested) {
      const result: ApprovalResult = {
        approvalId,
        effectDigest,
        status: "cancelled",
      }
      await emitResolution(input, result)
    }
    throw error
  } finally {
    scope.dispose()
  }
}

function approvalRequest(
  input: ApprovalExecutionInput,
  approvalId: ReturnType<typeof ApprovalIdSchema.parse>,
  effectDigest: EffectDigest,
): ApprovalRequest {
  return {
    ...input.context,
    approvalId,
    itemId: input.itemId,
    toolCallId: input.call.id,
    toolName: input.prepared.toolIdentity.name ?? input.call.name,
    capabilities: input.prepared.capabilities,
    toolIdentity: input.prepared.toolIdentity,
    effectDigest,
    reason: input.reason,
    createdAt: Date.now(),
  }
}

async function emitResolution(
  input: ApprovalExecutionInput,
  result: ApprovalResult,
): Promise<void> {
  await input.run.emit({
    type: "approval.resolved",
    turnId: input.context.turnId,
    itemId: input.itemId,
    approvalId: result.approvalId,
    effectDigest: result.effectDigest,
    approvalStatus: result.status,
    toolCallId: input.call.id,
    toolName: input.prepared.toolIdentity.name ?? input.call.name,
  })
}
