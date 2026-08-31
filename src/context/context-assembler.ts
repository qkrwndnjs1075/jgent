import type { ModelInput } from "../model/index.ts"
import type {
  ContextAssembly,
  ContextInput,
  ContextViewInput,
  InstructionProfile,
  SessionContextInput,
} from "./context-input.ts"

export class ContextAssembler {
  async build(input: ContextInput): Promise<ModelInput> {
    const profile = profileFields(input.instructionProfile)
    return input.continuation === undefined
      ? {
          messages: input.messages,
          tools: input.tools,
          ...(profile.instructions === undefined ? {} : { instructions: profile.instructions }),
        }
      : {
          messages: input.messages,
          tools: input.tools,
          ...(profile.instructions === undefined ? {} : { instructions: profile.instructions }),
          continuation: input.continuation,
        }
  }

  async buildView(input: ContextViewInput): Promise<ContextAssembly> {
    const profile = profileFields(input.instructionProfile)
    const memoryFingerprint = input.memoryProjection?.fingerprint
    const continuation =
      input.continuation?.contextViewId === input.contextViewId &&
      input.continuation.instructionFingerprint === profile.fingerprint &&
      input.continuation.memoryFingerprint === memoryFingerprint
        ? input.continuation.value
        : undefined
    const modelInput = await this.build({
      messages: prependMemory(input.messages, input.memoryProjection),
      tools: input.tools,
      ...(input.instructionProfile === undefined
        ? {}
        : { instructionProfile: input.instructionProfile }),
      ...(continuation === undefined ? {} : { continuation }),
    })
    return {
      input: modelInput,
      contextViewId: input.contextViewId,
      ...(profile.fingerprint === undefined ? {} : { instructionFingerprint: profile.fingerprint }),
      ...(memoryFingerprint === undefined ? {} : { memoryFingerprint }),
    }
  }

  async buildSession(input: SessionContextInput): Promise<ContextAssembly> {
    const { snapshot } = input
    const messages =
      snapshot.compaction === undefined
        ? snapshot.messages
        : [
            {
              role: "system" as const,
              content: `[Compacted history]\n${snapshot.compaction.summary}`,
            },
            ...snapshot.messages.slice(snapshot.compaction.coveredMessageCount),
          ]
    return this.buildView({
      messages,
      tools: input.tools,
      contextViewId: snapshot.contextViewId,
      ...(input.instructionProfile === undefined
        ? {}
        : { instructionProfile: input.instructionProfile }),
      ...(input.memoryProjection === undefined ? {} : { memoryProjection: input.memoryProjection }),
      ...(snapshot.continuation === undefined ? {} : { continuation: snapshot.continuation }),
    })
  }
}

function prependMemory(
  messages: ContextViewInput["messages"],
  projection: ContextViewInput["memoryProjection"],
): ContextViewInput["messages"] {
  if (projection === undefined || projection.records.length === 0) {
    return messages
  }
  if (projection.renderedDataBlock === undefined || projection.fingerprint === undefined) {
    throw new ContextInvariantError("Non-empty Memory projection is not rendered")
  }
  return [{ role: "system", content: projection.renderedDataBlock }, ...messages]
}

type ProfileFields = {
  readonly instructions?: string
  readonly fingerprint?: string
}

function profileFields(profile: InstructionProfile | undefined): ProfileFields {
  if (profile === undefined) {
    return {}
  }
  switch (profile.type) {
    case "empty":
      return {}
    case "instructions":
      return { instructions: profile.instructions, fingerprint: profile.fingerprint }
    default:
      return assertNever(profile)
  }
}

function assertNever(value: never): never {
  throw new ContextInvariantError(`Unexpected instruction profile: ${String(value)}`)
}

class ContextInvariantError extends Error {
  readonly name = "ContextInvariantError"
}
