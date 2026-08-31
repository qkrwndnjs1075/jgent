import { expect, test } from "bun:test"
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  InvalidSkillError,
  loadSkills,
  SkillLimitExceededError,
  SkillPathEscapeError,
} from "../../src/skill/index.ts"

async function createSkillRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "jgent-skills-"))
}

async function writeSkill(
  root: string,
  id: string,
  frontmatter: string,
  instructions: string,
): Promise<void> {
  const directory = join(root, id)
  await mkdir(directory)
  await writeFile(join(directory, "SKILL.md"), `---\n${frontmatter}\n---\n${instructions}\n`)
}

function loaderInput(root: string) {
  return { workspaceRoot: root, root }
}

test("loads bounded skills with directory ids and SHA-256 content digests", async () => {
  // Given
  const root = await createSkillRoot()
  await writeSkill(
    root,
    "pr-review",
    "name: PR Review\ndescription: Reviews pull requests",
    "Check the diff.",
  )

  // When
  const skills = await loadSkills(loaderInput(root))

  // Then
  expect(skills).toHaveLength(1)
  expect(skills[0]).toMatchObject({
    id: "pr-review",
    name: "PR Review",
    description: "Reviews pull requests",
    instructions: "Check the diff.",
  })
  expect(skills[0]?.contentDigest).toMatch(/^[a-f0-9]{64}$/)
  expect(Object.isFrozen(skills)).toBe(true)
  expect(Object.isFrozen(skills[0])).toBe(true)
})

test("rejects malformed or unknown frontmatter fields", async () => {
  // Given
  const root = await createSkillRoot()
  await writeSkill(root, "review", "name: Review\nsummary: Unsupported", "Review changes.")

  // When
  const loading = loadSkills(loaderInput(root))

  // Then
  await expect(loading).rejects.toBeInstanceOf(InvalidSkillError)
})

test("rejects skill files that escape the configured root through symlinks", async () => {
  // Given
  const root = await createSkillRoot()
  const outside = await createSkillRoot()
  await writeSkill(outside, "release", "name: Release\ndescription: Ships releases", "Publish.")
  await symlink(join(outside, "release"), join(root, "release"))

  // When
  const loading = loadSkills(loaderInput(root))

  // Then
  await expect(loading).rejects.toBeInstanceOf(SkillPathEscapeError)
})

test("enforces configured skill count and byte limits", async () => {
  // Given
  const countRoot = await createSkillRoot()
  await writeSkill(countRoot, "one", "name: One\ndescription: First", "One.")
  await writeSkill(countRoot, "two", "name: Two\ndescription: Second", "Two.")
  const byteRoot = await createSkillRoot()
  await writeSkill(byteRoot, "large", "name: Large\ndescription: Large skill", "Long instructions.")

  // When
  const countLoading = loadSkills({ ...loaderInput(countRoot), maxSkills: 1 })
  const byteLoading = loadSkills({ ...loaderInput(byteRoot), maxSkillBytes: 16 })

  // Then
  await expect(countLoading).rejects.toBeInstanceOf(SkillLimitExceededError)
  await expect(byteLoading).rejects.toBeInstanceOf(SkillLimitExceededError)
})

test("returns an empty immutable list when the skill root is absent", async () => {
  // Given
  const parent = await createSkillRoot()
  const root = join(parent, "missing")

  // When
  const skills = await loadSkills({ workspaceRoot: parent, root })

  // Then
  expect(skills).toEqual([])
  expect(Object.isFrozen(skills)).toBe(true)
})

test("rejects a configured skill root that resolves outside the workspace", async () => {
  // Given
  const workspaceRoot = await createSkillRoot()
  const outside = await createSkillRoot()
  await symlink(outside, join(workspaceRoot, "skills"))

  // When
  const loading = loadSkills({ workspaceRoot, root: join(workspaceRoot, "skills") })

  // Then
  await expect(loading).rejects.toBeInstanceOf(SkillPathEscapeError)
})

test("rejects a missing configured Skill root outside the workspace", async () => {
  // Given
  const workspaceRoot = await createSkillRoot()
  const outside = await createSkillRoot()
  const root = join(outside, "missing")

  // When
  const loading = loadSkills({ workspaceRoot, root })

  // Then
  await expect(loading).rejects.toBeInstanceOf(SkillPathEscapeError)
})

test("rejects a SKILL.md symlink that resolves outside the workspace", async () => {
  // Given
  const root = await createSkillRoot()
  const outside = await createSkillRoot()
  const directory = join(root, "release")
  await mkdir(directory)
  const outsideFile = join(outside, "SKILL.md")
  await writeFile(outsideFile, "---\nname: Release\ndescription: Ships releases\n---\nPublish.\n")
  await symlink(outsideFile, join(directory, "SKILL.md"))

  // When
  const loading = loadSkills(loaderInput(root))

  // Then
  await expect(loading).rejects.toBeInstanceOf(SkillPathEscapeError)
})

test("rejects duplicate keys, empty fields, NUL bytes, and invalid UTF-8", async () => {
  // Given
  const duplicateRoot = await createSkillRoot()
  await writeSkill(
    duplicateRoot,
    "duplicate",
    "name: One\nname: Two\ndescription: Duplicate",
    "Run.",
  )
  const emptyRoot = await createSkillRoot()
  await writeSkill(emptyRoot, "empty", "name: \ndescription: Empty", "Run.")
  const nulRoot = await createSkillRoot()
  await writeSkill(nulRoot, "nul", "name: Nul\ndescription: Contains\u0000Nul", "Run.")
  const utfRoot = await createSkillRoot()
  const utfDirectory = join(utfRoot, "utf")
  await mkdir(utfDirectory)
  await writeFile(join(utfDirectory, "SKILL.md"), Uint8Array.from([0xff, 0xfe]))

  // When
  const roots = [duplicateRoot, emptyRoot, nulRoot, utfRoot]

  // Then
  for (const root of roots) {
    await expect(loadSkills(loaderInput(root))).rejects.toBeInstanceOf(InvalidSkillError)
  }
})

test("keeps later delimiter lines in the instruction body", async () => {
  // Given
  const root = await createSkillRoot()
  await writeSkill(
    root,
    "sections",
    "name: Sections\ndescription: Uses sections",
    "First.\n---\nSecond.",
  )

  // When
  const skills = await loadSkills(loaderInput(root))

  // Then
  expect(skills[0]?.instructions).toBe("First.\n---\nSecond.")
})
