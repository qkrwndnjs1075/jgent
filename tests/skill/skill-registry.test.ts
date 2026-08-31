import { expect, test } from "bun:test"
import { createSkill, DuplicateSkillError, InMemorySkillRegistry } from "../../src/skill/index.ts"

test("registers a deeply immutable snapshot and finds it by id", () => {
  // Given
  const skill = createSkill({
    id: "testing",
    name: "Testing",
    description: "Runs focused tests",
    instructions: "Run the smallest relevant test suite.",
    sourcePath: "/skills/testing/SKILL.md",
  })

  // When
  const registry = new InMemorySkillRegistry([skill])

  // Then
  expect(registry.get(skill.id)).toEqual(skill)
  expect(registry.get(skill.id)).not.toBe(skill)
  expect(registry.list()).toEqual([skill])
  expect(Object.isFrozen(registry.list())).toBe(true)
  expect(Object.isFrozen(registry.list()[0])).toBe(true)
})

test("content digests cover model-visible fields but not source paths", () => {
  // Given
  const base = {
    id: "testing",
    name: "Testing",
    description: "Runs tests",
    instructions: "Run tests.",
  } as const

  // When
  const first = createSkill({ ...base, sourcePath: "/first/SKILL.md" })
  const moved = createSkill({ ...base, sourcePath: "/second/SKILL.md" })
  const renamed = createSkill({ ...base, name: "Test Runner", sourcePath: "/first/SKILL.md" })

  // Then
  expect(first.contentDigest).toBe(moved.contentDigest)
  expect(first.contentDigest).not.toBe(renamed.contentDigest)
})

test("rejects duplicate skill ids", () => {
  // Given
  const first = createSkill({
    id: "testing",
    name: "Testing",
    description: "Runs tests",
    instructions: "Run tests.",
    sourcePath: "/first/SKILL.md",
  })
  const second = createSkill({
    id: "testing",
    name: "Different",
    description: "Still duplicate",
    instructions: "Do something else.",
    sourcePath: "/second/SKILL.md",
  })

  // When
  const construct = (): InMemorySkillRegistry => new InMemorySkillRegistry([first, second])

  // Then
  expect(construct).toThrow(DuplicateSkillError)
})
