import type { CompletedRunMemoryInput } from "./memory.ts"

export interface MemoryCandidateExtractor {
  extract(input: CompletedRunMemoryInput): Promise<readonly unknown[]>
}

export class ExplicitMemoryCandidateExtractor implements MemoryCandidateExtractor {
  constructor(private readonly candidates: readonly unknown[]) {}

  async extract(): Promise<readonly unknown[]> {
    return this.candidates
  }
}
