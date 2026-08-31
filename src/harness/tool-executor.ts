import type { ToolCall, ToolResult } from "../core/index.ts"
import { abortReason, runAbortableOperation } from "./abort-scope.ts"
import type { ActiveRun } from "./active-run.ts"
import { requestApproval } from "./approval-executor.ts"
import { EffectDigestSchema, ItemIdSchema, type TurnContext } from "./contracts.ts"
import type { ExecutionScope } from "./execution-scope.ts"
import type { ItemRegistry } from "./item-registry.ts"
import { executePreparedToolAttempt } from "./tool-attempt.ts"
import {
  deniedResult,
  failureFor,
  isTerminalItemState,
  preparationFailure,
  preparationMessage,
} from "./tool-failure.ts"

export type ToolExecutionInput = {
  readonly run: ActiveRun
  readonly context: TurnContext
  readonly scope: ExecutionScope
  readonly items: ItemRegistry
  readonly call: ToolCall
}

export async function executeToolItem(input: ToolExecutionInput): Promise<ToolResult> {
  const itemId = input.run.createItemId()
  input.items.registerTool({
    itemId,
    turnId: input.context.turnId,
    toolCallId: input.call.id,
    toolName: input.call.name,
  })

  try {
    await input.run.emit({
      type: "tool.requested",
      phase: "request",
      turnId: input.context.turnId,
      itemId: ItemIdSchema.parse(itemId),
      toolCallId: input.call.id,
      toolName: input.call.name,
    })

    const preparation = input.run.options.toolRuntime.prepare(input.call)
    if (!preparation.valid) {
      input.items.transition(itemId, "failed")
      await input.run.emit({
        type: "tool.failed",
        phase: "preparation",
        turnId: input.context.turnId,
        itemId: ItemIdSchema.parse(itemId),
        toolCallId: input.call.id,
        toolName: input.call.name,
        reason: "Tool preparation failed",
        failure: preparationFailure(preparationMessage(preparation.result)),
      })
      return preparation.result
    }

    const prepared = preparation.prepared
    const preparedToolName = prepared.toolIdentity.name ?? input.call.name
    const decision = await runAbortableOperation(input.scope.signal, () =>
      input.run.options.capabilityPolicy.evaluate({
        ...input.context,
        toolCallId: input.call.id,
        toolName: preparedToolName,
        capabilities: prepared.capabilities,
        toolIdentity: prepared.toolIdentity,
        effectDigest: EffectDigestSchema.parse(prepared.effectDigest),
      }),
    )

    if (input.scope.signal.aborted) {
      throw abortReason(input.scope.signal)
    }

    if (decision.type === "deny") {
      input.items.transition(itemId, "denied")
      await input.run.emit({
        type: "tool.denied",
        phase: "authorization",
        turnId: input.context.turnId,
        itemId: ItemIdSchema.parse(itemId),
        toolCallId: input.call.id,
        toolName: input.call.name,
        reason: "policy_denied",
      })
      return deniedResult(input.call.id, `Tool denied: ${decision.reason}`)
    }

    if (decision.type === "ask") {
      input.items.transition(itemId, "awaiting_approval")
      const approval = await requestApproval({
        run: input.run,
        context: input.context,
        itemId: ItemIdSchema.parse(itemId),
        call: input.call,
        prepared,
        reason: decision.reason,
      })
      if (approval.status !== "approved") {
        input.items.transition(itemId, "denied")
        await input.run.emit({
          type: "tool.denied",
          phase: "authorization",
          turnId: input.context.turnId,
          itemId: ItemIdSchema.parse(itemId),
          toolCallId: input.call.id,
          toolName: input.call.name,
          reason: `approval_${approval.status}`,
        })
        return deniedResult(input.call.id, `Tool approval ${approval.status}`)
      }
    }

    return await executePreparedToolAttempt({
      run: input.run,
      context: input.context,
      scope: input.scope,
      items: input.items,
      itemId,
      call: input.call,
      prepared,
    })
  } catch (error) {
    const current = input.items.get(itemId)
    if (current !== undefined && !isTerminalItemState(current.state)) {
      input.items.transition(itemId, input.context.signal.aborted ? "cancelled" : "failed")
      await input.run.emit({
        type: "tool.failed",
        phase: "preparation",
        turnId: input.context.turnId,
        itemId: ItemIdSchema.parse(itemId),
        toolCallId: input.call.id,
        toolName: input.call.name,
        reason: "Tool authorization failed",
        failure: failureFor(error),
      })
    }
    throw error
  }
}
