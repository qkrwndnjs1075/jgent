import { expect, test } from "bun:test"
import {
  MAX_MEMORY_CONTENT_BYTES,
  MAX_MEMORY_PROJECTION_BYTES,
  MAX_MEMORY_PROJECTION_RECORDS,
  MAX_MEMORY_SEARCH_RESULTS,
  MAX_MEMORY_SUBJECT_BYTES,
  MAX_MEMORY_TAG_BYTES,
  MAX_MEMORY_TAGS,
  MemoryCandidateSchema,
  MemoryProjectionSchema,
  MemoryRecordSchema,
  MemoryScopeSchema,
  MemorySearchQuerySchema,
  MemorySourceSchema,
} from "../../src/index.ts"

const sessionId = "018f72d0-4e88-7e3f-a737-4e8b03724a0e"
const fingerprint = "a".repeat(64)

test("parses every explicitly scoped durable-memory record boundary", () => {
  // Given
  const scopes = [
    { type: "workspace", workspaceId: "workspace-1" },
    { type: "user", userId: "user-1" },
    { type: "workspace_user", workspaceId: "workspace-1", userId: "user-1" },
  ]

  // When
  const parsedScopes = scopes.map((scope) => MemoryScopeSchema.safeParse(scope))
  const parsedRecords = scopes.map((scope) =>
    MemoryRecordSchema.safeParse(validRecord({ scope, kind: "project" })),
  )

  // Then
  expect(parsedScopes.every((result) => result.success)).toBe(true)
  expect(parsedRecords.every((result) => result.success)).toBe(true)
})

test("rejects missing or mixed durable-memory scope identifiers", () => {
  // Given
  const invalidScopes = [
    { type: "workspace" },
    { type: "user" },
    { type: "workspace_user", workspaceId: "workspace-1" },
    { type: "workspace_user", userId: "user-1" },
    { type: "workspace_user" },
    { type: "workspace", workspaceId: "workspace-1", userId: "user-1" },
    { type: "user", workspaceId: "workspace-1", userId: "user-1" },
    {
      type: "workspace_user",
      workspaceId: "workspace-1",
      userId: "user-1",
      unexpectedId: "unexpected",
    },
  ]

  // When
  const results = invalidScopes.map((scope) => MemoryScopeSchema.safeParse(scope))

  // Then
  expect(results.every((result) => !result.success)).toBe(true)
})

test("requires preference subject keys and rejects them for other durable-memory kinds", () => {
  // Given
  const preferenceWithoutSubject = validCandidate({ kind: "preference" })
  const projectWithSubject = validCandidate({ kind: "project", subjectKey: "editor" })
  const preference = validCandidate({ kind: "preference", subjectKey: "editor" })
  const preferenceRecordWithoutSubject = validRecord({
    kind: "preference",
    scope: { type: "workspace", workspaceId: "workspace-1" },
  })
  const projectRecordWithSubject = validRecord({
    kind: "project",
    scope: { type: "workspace", workspaceId: "workspace-1" },
    subjectKey: "editor",
  })
  const preferenceRecord = validRecord({
    kind: "preference",
    scope: { type: "workspace", workspaceId: "workspace-1" },
    subjectKey: "editor",
  })

  // When
  const missingSubject = MemoryCandidateSchema.safeParse(preferenceWithoutSubject)
  const forbiddenSubject = MemoryCandidateSchema.safeParse(projectWithSubject)
  const acceptedPreference = MemoryCandidateSchema.safeParse(preference)
  const missingRecordSubject = MemoryRecordSchema.safeParse(preferenceRecordWithoutSubject)
  const forbiddenRecordSubject = MemoryRecordSchema.safeParse(projectRecordWithSubject)
  const acceptedPreferenceRecord = MemoryRecordSchema.safeParse(preferenceRecord)

  // Then
  expect(missingSubject.success).toBe(false)
  expect(forbiddenSubject.success).toBe(false)
  expect(acceptedPreference.success).toBe(true)
  expect(missingRecordSubject.success).toBe(false)
  expect(forbiddenRecordSubject.success).toBe(false)
  expect(acceptedPreferenceRecord.success).toBe(true)
})

test("rejects half-open range inversions and byte-boundary overflow", () => {
  // Given
  const invalidRange = { sessionId, sourceRevision: 3, messageRange: { start: 2, end: 1 } }
  const oversizedContent = validCandidate({ content: "a".repeat(MAX_MEMORY_CONTENT_BYTES + 1) })
  const oversizedTag = validCandidate({ tags: ["a".repeat(MAX_MEMORY_TAG_BYTES + 1)] })
  const tooManyTags = validCandidate({
    tags: Array.from({ length: MAX_MEMORY_TAGS + 1 }, (_, index) => `tag-${index}`),
  })
  const oversizedSubject = validCandidate({
    kind: "preference",
    subjectKey: "a".repeat(MAX_MEMORY_SUBJECT_BYTES + 1),
  })

  // When
  const sourceResult = MemorySourceSchema.safeParse(invalidRange)
  const contentResult = MemoryCandidateSchema.safeParse(oversizedContent)
  const tagResult = MemoryCandidateSchema.safeParse(oversizedTag)
  const tagCountResult = MemoryCandidateSchema.safeParse(tooManyTags)
  const subjectResult = MemoryCandidateSchema.safeParse(oversizedSubject)

  // Then
  expect(sourceResult.success).toBe(false)
  expect(contentResult.success).toBe(false)
  expect(tagResult.success).toBe(false)
  expect(tagCountResult.success).toBe(false)
  expect(subjectResult.success).toBe(false)
})

test("accepts only nonnegative integer record creation timestamps", () => {
  // Given
  const validRecordTimestamp = validRecord({
    kind: "project",
    scope: { type: "workspace", workspaceId: "workspace-1" },
  })
  const negativeTimestamp = { ...validRecordTimestamp, createdAt: -1 }
  const legacyIsoTimestamp = { ...validRecordTimestamp, createdAt: "2026-08-31T00:00:00.000Z" }

  // When
  const validResult = MemoryRecordSchema.safeParse(validRecordTimestamp)
  const negativeResult = MemoryRecordSchema.safeParse(negativeTimestamp)
  const legacyIsoResult = MemoryRecordSchema.safeParse(legacyIsoTimestamp)

  // Then
  expect(validResult.success).toBe(true)
  expect(negativeResult.success).toBe(false)
  expect(legacyIsoResult.success).toBe(false)
})

test("parses exact lower and multibyte UTF-8 upper boundaries", () => {
  // Given
  const contentAtLimit = "é".repeat(2048)
  const tagAtLimit = "é".repeat(32)
  const subjectAtLimit = "é".repeat(64)
  const tagsAtLimit = Array.from({ length: 8 }, () => "a")
  const oneByteSubjectKey = "a"
  const oneByteContent = validCandidate({ content: "a" })
  const exactContent = validCandidate({ content: contentAtLimit })
  const oneByteTag = validCandidate({ tags: ["a"] })
  const exactTag = validCandidate({ tags: [tagAtLimit] })
  const exactTagCount = validCandidate({
    tags: tagsAtLimit,
  })
  const oneByteSubject = validCandidate({ kind: "preference", subjectKey: oneByteSubjectKey })
  const exactSubject = validCandidate({ kind: "preference", subjectKey: subjectAtLimit })

  // When
  const contentLowerResult = MemoryCandidateSchema.safeParse(oneByteContent)
  const contentUpperResult = MemoryCandidateSchema.safeParse(exactContent)
  const tagLowerResult = MemoryCandidateSchema.safeParse(oneByteTag)
  const tagUpperResult = MemoryCandidateSchema.safeParse(exactTag)
  const tagCountResult = MemoryCandidateSchema.safeParse(exactTagCount)
  const subjectLowerResult = MemoryCandidateSchema.safeParse(oneByteSubject)
  const subjectUpperResult = MemoryCandidateSchema.safeParse(exactSubject)

  // Then
  expect(utf8ByteLength("a")).toBe(1)
  expect(utf8ByteLength(contentAtLimit)).toBe(4096)
  expect(utf8ByteLength(tagAtLimit)).toBe(64)
  expect(utf8ByteLength(oneByteSubjectKey)).toBe(1)
  expect(utf8ByteLength(subjectAtLimit)).toBe(128)
  expect(tagsAtLimit).toHaveLength(8)
  expect(contentLowerResult.success).toBe(true)
  expect(contentUpperResult.success).toBe(true)
  expect(tagLowerResult.success).toBe(true)
  expect(tagUpperResult.success).toBe(true)
  expect(tagCountResult.success).toBe(true)
  expect(subjectLowerResult.success).toBe(true)
  expect(subjectUpperResult.success).toBe(true)
})

test("rejects empty and multibyte UTF-8 boundary-plus-one candidate fields", () => {
  // Given
  const contentOverLimit = `${"é".repeat(2048)}a`
  const tagOverLimit = `${"é".repeat(32)}a`
  const subjectOverLimit = `${"é".repeat(64)}a`
  const tagsOverLimit = Array.from({ length: 9 }, () => "a")
  const emptyContent = validCandidate({ content: "" })
  const contentOverrun = validCandidate({ content: contentOverLimit })
  const emptyTag = validCandidate({ tags: [""] })
  const tagOverrun = validCandidate({ tags: [tagOverLimit] })
  const tooManyTags = validCandidate({
    tags: tagsOverLimit,
  })
  const emptySubject = validCandidate({ kind: "preference", subjectKey: "" })
  const subjectOverrun = validCandidate({ kind: "preference", subjectKey: subjectOverLimit })

  // When
  const emptyContentResult = MemoryCandidateSchema.safeParse(emptyContent)
  const contentOverrunResult = MemoryCandidateSchema.safeParse(contentOverrun)
  const emptyTagResult = MemoryCandidateSchema.safeParse(emptyTag)
  const tagOverrunResult = MemoryCandidateSchema.safeParse(tagOverrun)
  const tagCountResult = MemoryCandidateSchema.safeParse(tooManyTags)
  const emptySubjectResult = MemoryCandidateSchema.safeParse(emptySubject)
  const subjectOverrunResult = MemoryCandidateSchema.safeParse(subjectOverrun)

  // Then
  expect(utf8ByteLength("")).toBe(0)
  expect(utf8ByteLength(contentOverLimit)).toBe(4097)
  expect(utf8ByteLength(tagOverLimit)).toBe(65)
  expect(utf8ByteLength(subjectOverLimit)).toBe(129)
  expect(tagsOverLimit).toHaveLength(9)
  expect(emptyContentResult.success).toBe(false)
  expect(contentOverrunResult.success).toBe(false)
  expect(emptyTagResult.success).toBe(false)
  expect(tagOverrunResult.success).toBe(false)
  expect(tagCountResult.success).toBe(false)
  expect(emptySubjectResult.success).toBe(false)
  expect(subjectOverrunResult.success).toBe(false)
})

test("rejects retrieval and rendered-projection bounds before store access", () => {
  // Given
  const oversizedProjection = {
    records: Array.from({ length: MAX_MEMORY_PROJECTION_RECORDS + 1 }, () =>
      validRecord({ kind: "project", scope: { type: "workspace", workspaceId: "workspace-1" } }),
    ),
    renderedDataBlock: "a".repeat(MAX_MEMORY_PROJECTION_BYTES + 1),
  }
  const emptyTerms = {
    accessScope: { type: "workspace", workspaceId: "workspace-1" },
    terms: [],
    limit: 1,
  }
  const oversizedLimit = {
    accessScope: { type: "workspace", workspaceId: "workspace-1" },
    terms: ["task"],
    limit: MAX_MEMORY_SEARCH_RESULTS + 1,
  }

  // When
  const projectionResult = MemoryProjectionSchema.safeParse(oversizedProjection)
  const emptyTermsResult = MemorySearchQuerySchema.safeParse(emptyTerms)
  const oversizedLimitResult = MemorySearchQuerySchema.safeParse(oversizedLimit)

  // Then
  expect(projectionResult.success).toBe(false)
  expect(emptyTermsResult.success).toBe(false)
  expect(oversizedLimitResult.success).toBe(false)
})

function validCandidate(input: {
  readonly kind?: "project" | "workflow" | "preference" | "lesson"
  readonly content?: string
  readonly tags?: readonly string[]
  readonly subjectKey?: string
}): object {
  const kind = input.kind ?? "project"
  return {
    kind,
    targetScope: "workspace",
    content: input.content ?? "Use focused tests before broad checks.",
    tags: input.tags ?? ["testing"],
    durable: true,
    generalizable: true,
    sensitivity: "non_sensitive",
    rawHistory: false,
    sourceRange: { start: 0, end: 1 },
    ...(input.subjectKey === undefined ? {} : { subjectKey: input.subjectKey }),
  }
}

function validRecord(input: {
  readonly kind: "project" | "workflow" | "preference" | "lesson"
  readonly scope: object
  readonly subjectKey?: string
}): object {
  return {
    id: "018f72d0-4e88-7e3f-a737-4e8b03724a0e",
    deduplicationKey: fingerprint,
    fingerprint,
    kind: input.kind,
    content: "Use focused tests before broad checks.",
    tags: ["testing"],
    scope: input.scope,
    ...(input.subjectKey === undefined ? {} : { subjectKey: input.subjectKey }),
    source: {
      sessionId,
      sourceRevision: 3,
      messageRange: { start: 0, end: 1 },
    },
    createdAt: 1,
  }
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
