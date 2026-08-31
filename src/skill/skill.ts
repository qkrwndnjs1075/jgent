import { createHash } from "node:crypto"
import { z } from "zod"

const SkillIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .brand("SkillId")

const SkillContentDigestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand("SkillContentDigest")

const VisibleTextSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.includes("\u0000"), "must not contain NUL bytes")

export type SkillId = z.infer<typeof SkillIdSchema>
export type SkillContentDigest = z.infer<typeof SkillContentDigestSchema>

export type Skill = {
  readonly id: SkillId
  readonly name: string
  readonly description: string
  readonly instructions: string
  readonly contentDigest: SkillContentDigest
  readonly sourcePath: string
}

export type CreateSkillInput = {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly instructions: string
  readonly sourcePath: string
}

const CreateSkillInputSchema = z
  .object({
    id: SkillIdSchema,
    name: VisibleTextSchema,
    description: VisibleTextSchema,
    instructions: VisibleTextSchema,
    sourcePath: z
      .string()
      .min(1)
      .refine((value) => !value.includes("\u0000")),
  })
  .strict()

export function createSkill(input: CreateSkillInput): Skill {
  const parsed = CreateSkillInputSchema.parse(input)
  const modelVisible = {
    id: parsed.id,
    name: parsed.name,
    description: parsed.description,
    instructions: parsed.instructions,
  }
  const contentDigest = SkillContentDigestSchema.parse(
    createHash("sha256").update(JSON.stringify(modelVisible)).digest("hex"),
  )
  return Object.freeze({ ...parsed, contentDigest })
}

export function fingerprintSkills(skills: readonly Skill[]): SkillContentDigest {
  const profile = skills.map(({ id, contentDigest }) => [id, contentDigest])
  return SkillContentDigestSchema.parse(
    createHash("sha256").update(JSON.stringify(profile)).digest("hex"),
  )
}
