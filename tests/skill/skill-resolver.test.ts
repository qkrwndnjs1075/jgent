import { expect, test } from "bun:test"
import { createSkill, InMemorySkillRegistry, LexicalSkillResolver } from "../../src/skill/index.ts"

function skill(id: string, name: string, description: string) {
  return createSkill({
    id,
    name,
    description,
    instructions: `Instructions for ${id}.`,
    sourcePath: `/skills/${id}/SKILL.md`,
  })
}

test("selects at most three unique matching skills in deterministic relevance order", () => {
  // Given
  const registry = new InMemorySkillRegistry([
    skill("testing", "Testing", "test verification"),
    skill("pr-review", "PR Review", "review pull request changes"),
    skill("release-review", "Release Review", "review release readiness"),
    skill("security-review", "Security Review", "review security changes"),
    skill("debugging", "Debugging", "find runtime bugs"),
  ])
  const resolver = new LexicalSkillResolver(registry)

  // When
  const first = resolver.resolve({ task: "review PR security release changes", cwd: "/repo" })
  const second = resolver.resolve({ task: "review PR security release changes", cwd: "/repo" })

  // Then
  expect(first.skills.map(({ id }) => String(id))).toEqual([
    "pr-review",
    "security-review",
    "release-review",
  ])
  expect(first.skills).toEqual(second.skills)
  expect(first.fingerprint).toBe(second.fingerprint)
  expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/)
})

test("returns an empty resolved set when no skill matches", () => {
  // Given
  const resolver = new LexicalSkillResolver(
    new InMemorySkillRegistry([skill("testing", "Testing", "runs tests")]),
  )

  // When
  const resolution = resolver.resolve({ task: "write documentation", cwd: "/repo" })

  // Then
  expect(resolution.skills).toEqual([])
  expect(resolution.fingerprint).toMatch(/^[a-f0-9]{64}$/)
})
