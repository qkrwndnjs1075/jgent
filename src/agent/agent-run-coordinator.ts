import type { CompactionPolicy, Compactor } from "../compaction/index.ts"
import {
  type ContextAssembler,
  type InstructionProfile,
  instructionProfileFingerprint,
} from "../context/index.ts"
import type { ExecutionHarness } from "../harness/index.ts"
import type { MemoryAccessScope, MemoryProjection, MemoryWriter } from "../memory/index.ts"
import type { ModelClient } from "../model/index.ts"
import type { AgentSession, SessionSnapshot } from "../session/index.ts"
import { AgentLoopInvariantError, type AgentRunOptions } from "./agent-run-input.ts"
import { AgentTurnExecutor } from "./agent-turn-executor.ts"

export type CompletedAgentRun = {
  readonly content: string
  readonly initialMessageCount: number
  readonly finalSnapshot: SessionSnapshot
}

export type AgentRunCoordinatorInput = {
  readonly session: AgentSession
  readonly userInput: string
  readonly options: AgentRunOptions
  readonly instructionProfile: InstructionProfile
  readonly memoryProjection?: MemoryProjection
}

export type AgentRunCoordinatorOptions = {
  readonly modelClient: ModelClient
  readonly harness: ExecutionHarness
  readonly contextAssembler: ContextAssembler
  readonly compactionPolicy?: CompactionPolicy
  readonly compactor?: Compactor
  readonly memory?: {
    readonly accessScope: MemoryAccessScope
    readonly writer: MemoryWriter
  }
}

export class AgentRunCoordinator {
  private readonly turnExecutor: AgentTurnExecutor

  constructor(private readonly options: AgentRunCoordinatorOptions) {
    this.turnExecutor = new AgentTurnExecutor(options.modelClient)
  }

  async run(input: AgentRunCoordinatorInput): Promise<CompletedAgentRun> {
    return this.options.harness.withRun(input.options, async (run) => {
      let snapshot = await input.session.snapshot()
      const initialMessageCount = snapshot.messages.length
      const profileFingerprint = instructionProfileFingerprint(input.instructionProfile)
      const memoryFingerprint = input.memoryProjection?.fingerprint
      const clearContinuation =
        snapshot.continuation !== undefined &&
        (snapshot.continuation.instructionFingerprint !== profileFingerprint ||
          snapshot.continuation.memoryFingerprint !== memoryFingerprint)
      snapshot = await input.session.checkpoint({
        expectedRevision: snapshot.revision,
        append: [{ role: "user", content: input.userInput }],
        ...(clearContinuation ? { continuation: { type: "clear" as const } } : {}),
      })

      while (true) {
        const checkpoint = await this.compactionCheckpoint(snapshot)
        if (checkpoint !== undefined) {
          snapshot = await input.session.checkpoint({
            expectedRevision: snapshot.revision,
            compaction: { type: "replace", checkpoint },
          })
        }

        const assembly = await this.options.contextAssembler.buildSession({
          snapshot,
          tools: run.exposedTools,
          instructionProfile: input.instructionProfile,
          ...(input.memoryProjection === undefined
            ? {}
            : { memoryProjection: input.memoryProjection }),
        })
        const result = await run.withTurn((turn) =>
          this.turnExecutor.execute({ turn, assembly, session: input.session, snapshot }),
        )

        switch (result.type) {
          case "completed": {
            const completed = freezeCompletedAgentRun({
              content: result.content,
              initialMessageCount,
              finalSnapshot: result.snapshot,
            })
            if (this.options.memory !== undefined) {
              await this.options.memory.writer.write({
                sessionId: result.snapshot.id,
                sourceRevision: result.snapshot.revision,
                messageRange: {
                  start: initialMessageCount,
                  end: result.snapshot.messages.length,
                },
                task: input.userInput,
                accessScope: this.options.memory.accessScope,
                messages: result.snapshot.messages.slice(initialMessageCount),
                signal: run.context.signal,
              })
            }
            return completed
          }
          case "continue":
            snapshot = result.snapshot
            break
          default:
            return assertNever(result)
        }
      }
    })
  }

  private async compactionCheckpoint(snapshot: SessionSnapshot) {
    const { compactionPolicy, compactor } = this.options
    if (compactionPolicy === undefined || compactor === undefined) {
      return undefined
    }

    const decision = compactionPolicy.decide(snapshot)
    switch (decision.type) {
      case "keep":
        return undefined
      case "compact":
        return compactor.compact({
          snapshot,
          coveredMessageCount: decision.coveredMessageCount,
        })
      default:
        return assertNever(decision)
    }
  }
}

function freezeCompletedAgentRun(run: CompletedAgentRun): CompletedAgentRun {
  return Object.freeze(run)
}

function assertNever(value: never): never {
  throw new AgentLoopInvariantError(`Unexpected agent turn result: ${String(value)}`)
}
