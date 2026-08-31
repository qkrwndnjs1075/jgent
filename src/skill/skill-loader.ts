import { readdir, readFile, realpath, stat } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { ZodError, z } from "zod"
import { InvalidSkillError, SkillLimitExceededError, SkillPathEscapeError } from "./errors.ts"
import { createSkill, type Skill } from "./skill.ts"

const DEFAULT_MAX_SKILLS = 64
const DEFAULT_MAX_SKILL_BYTES = 64 * 1024
const SKILL_FILENAME = "SKILL.md"

const FrontmatterSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .refine((value) => !value.includes("\u0000")),
    description: z
      .string()
      .trim()
      .min(1)
      .refine((value) => !value.includes("\u0000")),
  })
  .strict()

export type LoadSkillsInput = {
  readonly workspaceRoot: string
  readonly root?: string
  readonly maxSkills?: number
  readonly maxSkillBytes?: number
}

export async function loadSkills(input: LoadSkillsInput): Promise<readonly Skill[]> {
  const maxSkills = positiveLimit(input.maxSkills ?? DEFAULT_MAX_SKILLS, "maxSkills")
  const maxSkillBytes = positiveLimit(
    input.maxSkillBytes ?? DEFAULT_MAX_SKILL_BYTES,
    "maxSkillBytes",
  )
  const configuredWorkspaceRoot = resolve(input.workspaceRoot)
  const configuredRoot = resolve(
    configuredWorkspaceRoot,
    input.root ?? join(configuredWorkspaceRoot, ".my-agent", "skills"),
  )
  assertContained(configuredWorkspaceRoot, configuredRoot)
  const workspaceRoot = await realpath(configuredWorkspaceRoot)
  const root = await resolveRoot(configuredRoot)
  if (root === null) {
    return Object.freeze([])
  }
  assertContained(workspaceRoot, root)
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .sort((left, right) => compareAscii(left.name, right.name))
  if (entries.length > maxSkills) {
    throw new SkillLimitExceededError("count", maxSkills, entries.length)
  }

  const skills: Skill[] = []
  for (const entry of entries) {
    const directory = await containedRealpath(root, join(root, entry.name))
    const sourcePath = await containedRealpath(root, join(directory, SKILL_FILENAME))
    const metadata = await stat(sourcePath)
    if (!metadata.isFile()) {
      throw new InvalidSkillError(sourcePath, `${SKILL_FILENAME} is not a file`)
    }
    if (metadata.size > maxSkillBytes) {
      throw new SkillLimitExceededError("bytes", maxSkillBytes, metadata.size)
    }
    const bytes = await readFile(sourcePath)
    if (bytes.byteLength > maxSkillBytes) {
      throw new SkillLimitExceededError("bytes", maxSkillBytes, bytes.byteLength)
    }
    const source = decodeSkill(sourcePath, bytes)
    skills.push(parseSkill(entry.name, sourcePath, source))
  }
  return Object.freeze(skills)
}

async function resolveRoot(root: string): Promise<string | null> {
  try {
    return await realpath(root)
  } catch (error) {
    if (isMissingPathError(error)) {
      return null
    }
    throw error
  }
}

async function containedRealpath(root: string, path: string): Promise<string> {
  const resolved = await realpath(path)
  assertContained(root, resolved)
  return resolved
}

function assertContained(root: string, resolved: string): void {
  const fromRoot = relative(root, resolved)
  if (
    fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot))
  ) {
    return
  }
  throw new SkillPathEscapeError(root, resolved)
}

function decodeSkill(sourcePath: string, bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (error) {
    if (error instanceof TypeError) {
      throw new InvalidSkillError(sourcePath, "content is not valid UTF-8", { cause: error })
    }
    throw error
  }
}

function parseSkill(id: string, sourcePath: string, source: string): Skill {
  const normalized = source.replaceAll("\r\n", "\n")
  const lines = normalized.split("\n")
  if (lines[0] !== "---") {
    throw new InvalidSkillError(sourcePath, "missing opening frontmatter delimiter")
  }
  const closing = lines.indexOf("---", 1)
  if (closing < 0) {
    throw new InvalidSkillError(sourcePath, "missing closing frontmatter delimiter")
  }
  const fields: Record<string, string> = {}
  for (const line of lines.slice(1, closing)) {
    const separator = line.indexOf(":")
    if (separator <= 0) {
      throw new InvalidSkillError(sourcePath, `malformed frontmatter line "${line}"`)
    }
    const key = line.slice(0, separator).trim()
    if (key in fields) {
      throw new InvalidSkillError(sourcePath, `duplicate frontmatter field "${key}"`)
    }
    fields[key] = line.slice(separator + 1).trim()
  }
  try {
    const metadata = FrontmatterSchema.parse(fields)
    return createSkill({
      id,
      ...metadata,
      instructions: lines
        .slice(closing + 1)
        .join("\n")
        .trim(),
      sourcePath,
    })
  } catch (error) {
    if (error instanceof ZodError) {
      throw new InvalidSkillError(sourcePath, error.issues[0]?.message ?? "invalid content", {
        cause: error,
      })
    }
    throw error
  }
}

function positiveLimit(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidSkillError(field, "limit must be a positive safe integer")
  }
  return value
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
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
