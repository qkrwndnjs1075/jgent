import { isAbsolute } from "node:path"
import { InvalidSkillResolutionInputError } from "./errors.ts"
import type { Skill, SkillContentDigest } from "./skill.ts"
import { fingerprintSkills } from "./skill.ts"
import type { SkillRegistry } from "./skill-registry.ts"

const MAX_RESOLVED_SKILLS = 3

export type SkillResolutionInput = {
  readonly task: string
  readonly cwd: string
}

export type SkillResolution = {
  readonly skills: readonly Skill[]
  readonly fingerprint: SkillContentDigest
}

export interface SkillResolver {
  resolve(input: SkillResolutionInput): SkillResolution
}

type RankedSkill = {
  readonly skill: Skill
  readonly score: number
}

export class LexicalSkillResolver implements SkillResolver {
  constructor(private readonly registry: SkillRegistry) {}

  resolve(input: SkillResolutionInput): SkillResolution {
    if (input.task.trim().length === 0) {
      throw new InvalidSkillResolutionInputError("task", "must not be empty")
    }
    if (!isAbsolute(input.cwd)) {
      throw new InvalidSkillResolutionInputError("cwd", "must be absolute")
    }
    const taskTerms = tokenize(input.task)
    const ranked: RankedSkill[] = []
    for (const skill of this.registry.list()) {
      const score = relevance(taskTerms, skill)
      if (score > 0) {
        ranked.push({ skill, score })
      }
    }
    ranked.sort(
      (left, right) => right.score - left.score || compareAscii(left.skill.id, right.skill.id),
    )
    const skills = Object.freeze(ranked.slice(0, MAX_RESOLVED_SKILLS).map(({ skill }) => skill))
    return Object.freeze({ skills, fingerprint: fingerprintSkills(skills) })
  }
}

function compareAscii(left: string, right: string): number {
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }
  return 0
}

function relevance(taskTerms: ReadonlySet<string>, skill: Skill): number {
  const skillTerms = tokenize(`${skill.id} ${skill.name} ${skill.description}`)
  let score = 0
  for (const term of skillTerms) {
    if (taskTerms.has(term)) {
      score += 1
    }
  }
  return score
}

function tokenize(value: string): ReadonlySet<string> {
  return new Set(
    value
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}]+/gu) ?? [],
  )
}
