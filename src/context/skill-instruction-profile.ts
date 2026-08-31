import { createHash } from "node:crypto"
import type { SkillResolution } from "../skill/index.ts"
import type { InstructionProfile } from "./context-input.ts"

const EMPTY_INSTRUCTION_PROFILE = Object.freeze({ type: "empty" as const })

export type CreateInstructionProfileInput = {
  readonly systemInstructions?: string
  readonly projectInstructions?: string
  readonly skillResolution?: SkillResolution
}

export function createSkillInstructionProfile(
  resolution: SkillResolution | undefined,
): InstructionProfile {
  return createInstructionProfile(resolution === undefined ? {} : { skillResolution: resolution })
}

export function createInstructionProfile(input: CreateInstructionProfileInput): InstructionProfile {
  const layers: InstructionLayer[] = []
  appendTextLayer(layers, "system", input.systemInstructions)
  appendTextLayer(layers, "project", input.projectInstructions)
  for (const skill of input.skillResolution?.skills ?? []) {
    layers.push({
      kind: "skill",
      id: skill.id,
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
    })
  }
  if (layers.length === 0) {
    return EMPTY_INSTRUCTION_PROFILE
  }

  const instructions = `<instructions>\n${JSON.stringify(layers)}\n</instructions>`
  return Object.freeze({
    type: "instructions" as const,
    instructions,
    fingerprint: createHash("sha256").update(instructions).digest("hex"),
  })
}

type InstructionLayer =
  | { readonly kind: "system"; readonly instructions: string }
  | { readonly kind: "project"; readonly instructions: string }
  | {
      readonly kind: "skill"
      readonly id: string
      readonly name: string
      readonly description: string
      readonly instructions: string
    }

function appendTextLayer(
  layers: InstructionLayer[],
  kind: "system" | "project",
  instructions: string | undefined,
): void {
  const content = instructions?.trim()
  if (content !== undefined && content.length > 0) {
    layers.push({ kind, instructions: content })
  }
}

export function instructionProfileFingerprint(profile: InstructionProfile): string | undefined {
  switch (profile.type) {
    case "empty":
      return undefined
    case "instructions":
      return profile.fingerprint
    default:
      return assertNever(profile)
  }
}

function assertNever(value: never): never {
  throw new InstructionProfileInvariantError(`Unexpected instruction profile: ${String(value)}`)
}

class InstructionProfileInvariantError extends Error {
  readonly name = "InstructionProfileInvariantError"
}
