import { createHash } from "node:crypto"
import {
  MAX_MEMORY_PROJECTION_BYTES,
  MAX_MEMORY_PROJECTION_RECORDS,
  MAX_MEMORY_SEARCH_RESULTS,
  type MemoryAccessScope,
  type MemoryProjection,
  MemoryProjectionSchema,
  type MemoryRecord,
} from "./memory.ts"
import { MemorySearchQuerySchema, type MemoryStore } from "./memory-store.ts"

export type MemoryRetrievalInput = {
  readonly task: string
  readonly accessScope: MemoryAccessScope
}

export type LexicalMemoryRetrieverOptions = {
  readonly maxRecords?: number
  readonly maxProjectionBytes?: number
}

export interface MemoryRetriever {
  retrieve(input: MemoryRetrievalInput): Promise<MemoryProjection>
}

export class LexicalMemoryRetriever implements MemoryRetriever {
  readonly #store: MemoryStore
  readonly #maxRecords: number
  readonly #maxProjectionBytes: number

  constructor(store: MemoryStore, options: LexicalMemoryRetrieverOptions = {}) {
    this.#store = store
    this.#maxRecords = boundedOption(
      options.maxRecords ?? MAX_MEMORY_PROJECTION_RECORDS,
      MAX_MEMORY_PROJECTION_RECORDS,
      "record",
    )
    this.#maxProjectionBytes = boundedOption(
      options.maxProjectionBytes ?? MAX_MEMORY_PROJECTION_BYTES,
      MAX_MEMORY_PROJECTION_BYTES,
      "byte",
    )
  }

  async retrieve(input: MemoryRetrievalInput): Promise<MemoryProjection> {
    const terms = tokenize(input.task)
    if (terms.length === 0) {
      return EMPTY_MEMORY_PROJECTION
    }
    const query = MemorySearchQuerySchema.parse({
      accessScope: input.accessScope,
      terms,
      limit: MAX_MEMORY_SEARCH_RESULTS,
    })
    const records = await this.#store.search(query)
    const ranked = records
      .map((record) => ({ record, score: scoreRecord(record, terms) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => compareRanked(left, right))
      .map(({ record }) => record)
    const selected = selectWithinBounds(ranked, this.#maxRecords, this.#maxProjectionBytes)
    return selected.length === 0 ? EMPTY_MEMORY_PROJECTION : createProjection(selected)
  }
}

const EMPTY_RECORDS: readonly MemoryRecord[] = []
const EMPTY_MEMORY_PROJECTION: MemoryProjection = Object.freeze({ records: EMPTY_RECORDS })

type RankedRecord = {
  readonly record: MemoryRecord
  readonly score: number
}

function boundedOption(value: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new MemoryRetrieverInvariantError(`Invalid Memory ${label} bound`)
  }
  return value
}

function tokenize(value: string): readonly string[] {
  const terms =
    value
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  return [...new Set(terms)]
}

function scoreRecord(record: MemoryRecord, terms: readonly string[]): number {
  const content = normalize(record.content)
  return terms.reduce((score, term) => {
    const contentScore = content.includes(term) ? 1 : 0
    const tagScore = record.tags.some((tag) => normalize(tag) === term) ? 4 : 0
    return score + contentScore + tagScore
  }, 0)
}

function compareRanked(left: RankedRecord, right: RankedRecord): number {
  if (left.score !== right.score) {
    return right.score - left.score
  }
  if (left.record.createdAt !== right.record.createdAt) {
    return right.record.createdAt - left.record.createdAt
  }
  return left.record.id < right.record.id ? -1 : left.record.id > right.record.id ? 1 : 0
}

function selectWithinBounds(
  records: readonly MemoryRecord[],
  maxRecords: number,
  maxBytes: number,
): readonly MemoryRecord[] {
  const selected: MemoryRecord[] = []
  for (const record of records) {
    if (selected.length >= maxRecords) {
      break
    }
    const candidate = [...selected, record]
    if (utf8Length(renderDataBlock(candidate)) <= maxBytes) {
      selected.push(record)
    }
  }
  return Object.freeze(selected)
}

function createProjection(records: readonly MemoryRecord[]): MemoryProjection {
  const renderedDataBlock = renderDataBlock(records)
  const fingerprint = createHash("sha256").update(renderedDataBlock, "utf8").digest("hex")
  const projection = MemoryProjectionSchema.parse({ records, renderedDataBlock, fingerprint })
  if (projection.renderedDataBlock === undefined || projection.fingerprint === undefined) {
    throw new MemoryRetrieverInvariantError("Memory projection fields were not rendered")
  }
  return deepFreeze({
    records: projection.records,
    renderedDataBlock: projection.renderedDataBlock,
    fingerprint: projection.fingerprint,
  })
}

function renderDataBlock(records: readonly MemoryRecord[]): string {
  const data = records.map(({ kind, content, tags, scope }) => ({ kind, content, tags, scope }))
  return `<memory_data>\n${JSON.stringify({ records: data })}\n</memory_data>`
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase()
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value
  }
  for (const child of Object.values(value)) {
    deepFreeze(child)
  }
  return Object.freeze(value)
}

export class MemoryRetrieverInvariantError extends Error {
  readonly name = "MemoryRetrieverInvariantError"
}
