import type { CompactionPolicy, Compactor } from "../compaction/index.ts"
import {
  type ContextAssembler,
  createInstructionProfile,
  type InstructionProfile,
} from "../context/index.ts"
import type { ExecutionHarness, StartRunInput } from "../harness/index.ts"
import type { MemoryAccessScope, MemoryRetriever, MemoryWriter } from "../memory/index.ts"
import type { ModelClient } from "../model/index.ts"
import { type AgentSession, InMemorySessionStore, type SessionStore } from "../session/index.ts"
import type { SkillResolver } from "../skill/index.ts"
import { AgentRunCoordinator } from "./agent-run-coordinator.ts"
import {
  AgentLoopInvariantError,
  type AgentRunOptions,
  resolveAgentRunInput,
} from "./agent-run-input.ts"

export type { AgentRunOptions } from "./agent-run-input.ts"
export { SessionNotFoundError } from "./agent-run-input.ts"

export type AgentLoopOptions = {
  readonly sessionStore?: SessionStore
  readonly compactionPolicy?: CompactionPolicy
  readonly compactor?: Compactor
  readonly skillResolver?: SkillResolver
  readonly cwd?: string
  readonly systemInstructions?: string
  readonly projectInstructions?: string
  readonly memory?: AgentMemoryConfiguration
}

export type AgentMemoryConfiguration = {
  readonly accessScope: MemoryAccessScope
  readonly retriever: MemoryRetriever
  readonly writer: MemoryWriter
}

export type AgentLoopConfiguration = AgentLoopOptions & {
  readonly contextAssembler: ContextAssembler
}

export class AgentLoop {
  private readonly sessionStore: SessionStore
  private readonly coordinator: AgentRunCoordinator
  private readonly skillResolver: SkillResolver | undefined
  private readonly cwd: string | undefined
  private readonly systemInstructions: string | undefined
  private readonly projectInstructions: string | undefined
  private readonly memory: AgentMemoryConfiguration | undefined

  constructor(
    modelClient: ModelClient,
    harness: ExecutionHarness,
    contextAssembler: ContextAssembler,
  )
  constructor(
    modelClient: ModelClient,
    harness: ExecutionHarness,
    configuration: AgentLoopConfiguration,
  )
  constructor(
    modelClient: ModelClient,
    harness: ExecutionHarness,
    contextAssemblerOrConfiguration: ContextAssembler | AgentLoopConfiguration,
  ) {
    const configuration =
      "contextAssembler" in contextAssemblerOrConfiguration
        ? contextAssemblerOrConfiguration
        : { contextAssembler: contextAssemblerOrConfiguration }
    if (
      (configuration.compactionPolicy === undefined) !==
      (configuration.compactor === undefined)
    ) {
      throw new AgentLoopInvariantError(
        "CompactionPolicy and Compactor must be configured together",
      )
    }
    if ((configuration.skillResolver === undefined) !== (configuration.cwd === undefined)) {
      throw new AgentLoopInvariantError("SkillResolver and cwd must be configured together")
    }
    this.sessionStore = configuration.sessionStore ?? new InMemorySessionStore()
    this.coordinator = new AgentRunCoordinator({
      modelClient,
      harness,
      contextAssembler: configuration.contextAssembler,
      ...(configuration.compactionPolicy === undefined
        ? {}
        : { compactionPolicy: configuration.compactionPolicy }),
      ...(configuration.compactor === undefined ? {} : { compactor: configuration.compactor }),
      ...(configuration.memory === undefined
        ? {}
        : {
            memory: {
              accessScope: configuration.memory.accessScope,
              writer: configuration.memory.writer,
            },
          }),
    })
    this.skillResolver = configuration.skillResolver
    this.cwd = configuration.cwd
    this.systemInstructions = configuration.systemInstructions
    this.projectInstructions = configuration.projectInstructions
    this.memory = configuration.memory
  }

  async run(userInput: string, options?: AgentRunOptions): Promise<string>
  async run(session: AgentSession, userInput: string, options?: StartRunInput): Promise<string>
  async run(
    sessionOrInput: AgentSession | string,
    userInputOrOptions: AgentRunOptions | string = {},
    explicitOptions: StartRunInput = {},
  ): Promise<string> {
    const resolved = await resolveAgentRunInput({
      sessionStore: this.sessionStore,
      sessionOrInput,
      userInputOrOptions,
      explicitOptions,
    })
    return resolved.session.withExclusiveRun(async () => {
      const resolution =
        this.skillResolver === undefined || this.cwd === undefined
          ? undefined
          : this.skillResolver.resolve({ task: resolved.userInput, cwd: this.cwd })
      const memoryProjection =
        this.memory === undefined
          ? undefined
          : await this.memory.retriever.retrieve({
              task: resolved.userInput,
              accessScope: this.memory.accessScope,
            })
      const result = await this.coordinator.run({
        session: resolved.session,
        userInput: resolved.userInput,
        options: resolved.options,
        instructionProfile: this.instructionProfile(resolution),
        ...(memoryProjection === undefined ? {} : { memoryProjection }),
      })
      return result.content
    })
  }

  private instructionProfile(
    resolution: ReturnType<SkillResolver["resolve"]> | undefined,
  ): InstructionProfile {
    return createInstructionProfile({
      ...(this.systemInstructions === undefined
        ? {}
        : { systemInstructions: this.systemInstructions }),
      ...(this.projectInstructions === undefined
        ? {}
        : { projectInstructions: this.projectInstructions }),
      ...(resolution === undefined ? {} : { skillResolution: resolution }),
    })
  }
}
