import { DuplicateSkillError } from "./errors.ts"
import type { Skill, SkillId } from "./skill.ts"

export interface SkillRegistry {
  readonly get: (id: SkillId) => Skill | undefined
  readonly list: () => readonly Skill[]
}

export class InMemorySkillRegistry implements SkillRegistry {
  readonly #skills: ReadonlyMap<SkillId, Skill>
  readonly #ordered: readonly Skill[]

  constructor(skills: readonly Skill[] = []) {
    const registered = new Map<SkillId, Skill>()
    for (const skill of skills) {
      if (registered.has(skill.id)) {
        throw new DuplicateSkillError(skill.id)
      }
      const snapshot = Object.freeze({ ...skill })
      registered.set(snapshot.id, snapshot)
    }
    this.#ordered = Object.freeze(
      [...registered.values()].sort((left, right) => compareAscii(left.id, right.id)),
    )
    this.#skills = registered
  }

  get(id: SkillId): Skill | undefined {
    return this.#skills.get(id)
  }

  list(): readonly Skill[] {
    return this.#ordered
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
