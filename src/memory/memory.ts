import { z } from "zod"
import type { AgentMessage } from "../core/index.ts"
import { SessionIdSchema, SessionRevisionSchema } from "../session/index.ts"

export const MAX_MEMORY_CONTENT_BYTES = 4096
export const MAX_MEMORY_TAGS = 8
export const MAX_MEMORY_TAG_BYTES = 64
export const MAX_MEMORY_SUBJECT_BYTES = 128
export const MAX_MEMORY_PROJECTION_RECORDS = 8
export const MAX_MEMORY_SEARCH_RESULTS = 64
export const MAX_MEMORY_PROJECTION_BYTES = 8192

const utf8Encoder = new TextEncoder()

export const MemoryIdSchema = z.string().uuid().brand<"MemoryId">()
export const WorkspaceIdSchema = z.string().trim().min(1).brand<"WorkspaceId">()
export const UserIdSchema = z.string().trim().min(1).brand<"UserId">()
export const MemoryKindSchema = z.enum(["project", "workflow", "preference", "lesson"])
export const MemoryFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const MemoryDeduplicationKeySchema = z.string().regex(/^[a-f0-9]{64}$/)
export const MemorySensitivitySchema = z.enum(["non_sensitive", "sensitive", "unknown"])

export type MemoryId = z.infer<typeof MemoryIdSchema>
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>
export type UserId = z.infer<typeof UserIdSchema>
export type MemoryKind = z.infer<typeof MemoryKindSchema>
export type MemorySensitivity = z.infer<typeof MemorySensitivitySchema>

const WorkspaceMemoryScopeSchema = z
  .object({ type: z.literal("workspace"), workspaceId: WorkspaceIdSchema })
  .strict()
const UserMemoryScopeSchema = z.object({ type: z.literal("user"), userId: UserIdSchema }).strict()
const WorkspaceUserMemoryScopeSchema = z
  .object({
    type: z.literal("workspace_user"),
    workspaceId: WorkspaceIdSchema,
    userId: UserIdSchema,
  })
  .strict()

export const MemoryScopeSchema = z.discriminatedUnion("type", [
  WorkspaceMemoryScopeSchema,
  UserMemoryScopeSchema,
  WorkspaceUserMemoryScopeSchema,
])
export const MemoryAccessScopeSchema = MemoryScopeSchema
export const MemoryTargetScopeKindSchema = z.enum(["workspace", "user", "workspace_user"])

export type MemoryScope =
  | { readonly type: "workspace"; readonly workspaceId: WorkspaceId }
  | { readonly type: "user"; readonly userId: UserId }
  | {
      readonly type: "workspace_user"
      readonly workspaceId: WorkspaceId
      readonly userId: UserId
    }
export type MemoryAccessScope = MemoryScope
export type MemoryTargetScopeKind = MemoryScope["type"]

export const MemoryMessageRangeSchema = z
  .object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
  .strict()
  .refine(({ start, end }) => start <= end, "message range must be half-open and ordered")

export const MemorySourceSchema = z
  .object({
    sessionId: SessionIdSchema,
    sourceRevision: SessionRevisionSchema,
    messageRange: MemoryMessageRangeSchema,
  })
  .strict()

export type MemoryMessageRange = {
  readonly start: number
  readonly end: number
}
export type MemorySource = {
  readonly sessionId: z.infer<typeof SessionIdSchema>
  readonly sourceRevision: z.infer<typeof SessionRevisionSchema>
  readonly messageRange: MemoryMessageRange
}

const MemoryContentSchema = boundedUtf8Text(1, MAX_MEMORY_CONTENT_BYTES)
const MemoryTagSchema = boundedUtf8Text(1, MAX_MEMORY_TAG_BYTES)
const MemorySubjectKeySchema = boundedUtf8Text(1, MAX_MEMORY_SUBJECT_BYTES)
const MemoryTagsSchema = z.array(MemoryTagSchema).max(MAX_MEMORY_TAGS)

const CandidateFields = {
  targetScope: MemoryTargetScopeKindSchema,
  content: MemoryContentSchema,
  tags: MemoryTagsSchema,
  durable: z.boolean(),
  generalizable: z.boolean(),
  sensitivity: MemorySensitivitySchema,
  rawHistory: z.boolean(),
  sourceRange: MemoryMessageRangeSchema,
}

export const MemoryCandidateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), ...CandidateFields }).strict(),
  z.object({ kind: z.literal("workflow"), ...CandidateFields }).strict(),
  z
    .object({
      kind: z.literal("preference"),
      subjectKey: MemorySubjectKeySchema,
      ...CandidateFields,
    })
    .strict(),
  z.object({ kind: z.literal("lesson"), ...CandidateFields }).strict(),
])

const RecordFields = {
  id: MemoryIdSchema,
  deduplicationKey: MemoryDeduplicationKeySchema,
  fingerprint: MemoryFingerprintSchema,
  content: MemoryContentSchema,
  tags: MemoryTagsSchema,
  scope: MemoryScopeSchema,
  source: MemorySourceSchema,
  createdAt: z.number().int().nonnegative(),
}

export const MemoryRecordSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), ...RecordFields }).strict(),
  z.object({ kind: z.literal("workflow"), ...RecordFields }).strict(),
  z
    .object({ kind: z.literal("preference"), subjectKey: MemorySubjectKeySchema, ...RecordFields })
    .strict(),
  z.object({ kind: z.literal("lesson"), ...RecordFields }).strict(),
])

export type MemoryCandidate =
  | (MemoryCandidateBase<"project"> & { readonly subjectKey?: never })
  | (MemoryCandidateBase<"workflow"> & { readonly subjectKey?: never })
  | (MemoryCandidateBase<"preference"> & { readonly subjectKey: string })
  | (MemoryCandidateBase<"lesson"> & { readonly subjectKey?: never })

export type MemoryRecord =
  | (MemoryRecordBase<"project"> & { readonly subjectKey?: never })
  | (MemoryRecordBase<"workflow"> & { readonly subjectKey?: never })
  | (MemoryRecordBase<"preference"> & { readonly subjectKey: string })
  | (MemoryRecordBase<"lesson"> & { readonly subjectKey?: never })

export type CompletedRunMemoryInput = {
  readonly sessionId: z.infer<typeof SessionIdSchema>
  readonly sourceRevision: z.infer<typeof SessionRevisionSchema>
  readonly messageRange: MemoryMessageRange
  readonly task: string
  readonly accessScope: MemoryAccessScope
  readonly messages: readonly AgentMessage[]
  readonly signal: AbortSignal
}

export const MemoryProjectionSchema = z
  .object({
    records: z.array(MemoryRecordSchema).max(MAX_MEMORY_PROJECTION_RECORDS),
    renderedDataBlock: z
      .string()
      .refine(
        (value) => utf8ByteLength(value) <= MAX_MEMORY_PROJECTION_BYTES,
        "rendered data block exceeds byte limit",
      )
      .optional(),
    fingerprint: MemoryFingerprintSchema.optional(),
  })
  .strict()

export type MemoryProjection = {
  readonly records: readonly MemoryRecord[]
  readonly renderedDataBlock?: string
  readonly fingerprint?: string
}

type MemoryCandidateBase<TKind extends MemoryKind> = {
  readonly kind: TKind
  readonly targetScope: MemoryTargetScopeKind
  readonly content: string
  readonly tags: readonly string[]
  readonly durable: boolean
  readonly generalizable: boolean
  readonly sensitivity: MemorySensitivity
  readonly rawHistory: boolean
  readonly sourceRange: MemoryMessageRange
}

type MemoryRecordBase<TKind extends MemoryKind> = {
  readonly id: MemoryId
  readonly deduplicationKey: string
  readonly fingerprint: string
  readonly kind: TKind
  readonly content: string
  readonly tags: readonly string[]
  readonly scope: MemoryScope
  readonly source: MemorySource
  readonly createdAt: number
}

function boundedUtf8Text(minimumBytes: number, maximumBytes: number) {
  return z.string().refine((value) => {
    const byteLength = utf8ByteLength(value)
    return byteLength >= minimumBytes && byteLength <= maximumBytes
  }, `must contain ${minimumBytes}-${maximumBytes} UTF-8 bytes`)
}

function utf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength
}
