import type { ContextAssembly } from "../context/index.ts"
import type { AgentMessage, ModelOutput } from "../core/index.ts"
import type { TurnExecution } from "../harness/index.ts"
import type { ModelClient } from "../model/index.ts"
import type { AgentSession, SessionSnapshot } from "../session/index.ts"
import { AgentLoopInvariantError } from "./agent-run-input.ts"

export type TurnResult =
  | {
      readonly type: "completed"
      readonly content: string
      readonly snapshot: SessionSnapshot
    }
  | {
      readonly type: "continue"
      readonly snapshot: SessionSnapshot
    }

export type TurnExecutionInput = {
  readonly turn: TurnExecution
  readonly assembly: ContextAssembly
  readonly session: AgentSession
  readonly snapshot: SessionSnapshot
}

export class AgentTurnExecutor {
  constructor(private readonly modelClient: ModelClient) {}

  async execute(input: TurnExecutionInput): Promise<TurnResult> {
    const { turn, assembly, session, snapshot } = input
    const output = await turn.executeModel(({ signal }) =>
      this.modelClient.generate(assembly.input, { signal }),
    )

    switch (output.stopReason) {
      case "completed":
        await turn.evaluateCompletion(output)
        return {
          type: "completed",
          content: output.content,
          snapshot: await session.checkpoint({
            expectedRevision: snapshot.revision,
            append: [{ role: "assistant", content: output.content }],
            continuation: continuationUpdate(
              output,
              assembly.instructionFingerprint,
              assembly.memoryFingerprint,
            ),
          }),
        }
      case "tool_calls": {
        const toolResults = await turn.executeTools(output.toolCalls)
        const assistantMessage: AgentMessage =
          output.content === undefined
            ? { role: "assistant", toolCalls: output.toolCalls }
            : { role: "assistant", content: output.content, toolCalls: output.toolCalls }
        return {
          type: "continue",
          snapshot: await session.checkpoint({
            expectedRevision: snapshot.revision,
            append: [
              assistantMessage,
              ...toolResults.map((toolResult) => ({ role: "tool" as const, result: toolResult })),
            ],
            continuation: continuationUpdate(
              output,
              assembly.instructionFingerprint,
              assembly.memoryFingerprint,
            ),
          }),
        }
      }
      default:
        return assertNever(output)
    }
  }
}

function continuationUpdate(
  output: ModelOutput,
  instructionFingerprint: string | undefined,
  memoryFingerprint: string | undefined,
) {
  return output.continuation === undefined
    ? ({ type: "clear" } as const)
    : ({
        type: "replace",
        continuation: output.continuation,
        ...(instructionFingerprint === undefined ? {} : { instructionFingerprint }),
        ...(memoryFingerprint === undefined ? {} : { memoryFingerprint }),
      } as const)
}

function assertNever(value: never): never {
  throw new AgentLoopInvariantError(`Unexpected model output: ${String(value)}`)
}
