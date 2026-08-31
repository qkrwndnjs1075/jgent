export class InvalidSkillError extends Error {
  readonly name = "InvalidSkillError"

  constructor(
    readonly sourcePath: string,
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`Invalid skill at "${sourcePath}": ${reason}`, options)
  }
}

export class DuplicateSkillError extends Error {
  readonly name = "DuplicateSkillError"

  constructor(readonly skillId: string) {
    super(`Skill "${skillId}" is already registered`)
  }
}

export class SkillPathEscapeError extends Error {
  readonly name = "SkillPathEscapeError"

  constructor(
    readonly root: string,
    readonly resolvedPath: string,
  ) {
    super(`Skill path "${resolvedPath}" escapes root "${root}"`)
  }
}

export class SkillLimitExceededError extends Error {
  readonly name = "SkillLimitExceededError"

  constructor(
    readonly limit: "count" | "bytes",
    readonly maximum: number,
    readonly actual: number,
  ) {
    super(`Skill ${limit} limit exceeded: ${actual} > ${maximum}`)
  }
}

export class InvalidSkillResolutionInputError extends Error {
  readonly name = "InvalidSkillResolutionInputError"

  constructor(
    readonly field: "task" | "cwd",
    readonly reason: string,
  ) {
    super(`Invalid skill resolution ${field}: ${reason}`)
  }
}
