import { createHash } from "node:crypto"
import { z } from "zod"
import type { Capability, ToolExecutionDescriptor, ToolIdentity } from "../core/contracts/tool.ts"

export const EFFECT_DIGEST_VERSION = "prepared-tool-effect/v1" as const
export const EffectDigestSchema = z.string().min(1).brand("EffectDigest")
export type EffectDigest = z.infer<typeof EffectDigestSchema>

export type EffectDigestInput = {
  readonly toolIdentity: ToolIdentity
  readonly input: object
  readonly capabilities: readonly Capability[]
  readonly executionDescriptor: ToolExecutionDescriptor
}

export function canonicalize<T>(value: T): T {
  const copy = structuredClone(value)
  canonicalizeInPlace(copy)
  return copy
}

export function deepFreeze<T>(value: T): T {
  if (!isObjectLike(value) || Object.isFrozen(value)) {
    return value
  }

  for (const child of Object.values(value)) {
    deepFreeze(child)
  }
  Object.freeze(value)
  return value
}

export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value))
  if (serialized === undefined) {
    throw new TypeError("Cannot canonicalize a non-JSON value")
  }
  return serialized
}

export function computeEffectDigest(effect: EffectDigestInput): string {
  const payload = {
    version: EFFECT_DIGEST_VERSION,
    toolIdentity: effect.toolIdentity,
    input: effect.input,
    capabilities: effect.capabilities,
    executionDescriptor: effect.executionDescriptor,
  }

  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex")
}

function canonicalizeInPlace(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) {
      canonicalizeInPlace(child)
    }
    return
  }

  if (!isRecord(value)) {
    return
  }

  const entries = Object.entries(value)
  for (const [, child] of entries) {
    canonicalizeInPlace(child)
  }
  entries.sort(([left], [right]) => compareKeys(left, right))

  for (const key of Object.keys(value)) {
    Reflect.deleteProperty(value, key)
  }
  for (const [key, child] of entries) {
    Object.defineProperty(value, key, {
      configurable: true,
      enumerable: true,
      value: child,
      writable: true,
    })
  }
}

function isObjectLike(value: unknown): value is Record<string, unknown> | readonly unknown[] {
  return value !== null && typeof value === "object"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function compareKeys(left: string, right: string): number {
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }
  return 0
}
