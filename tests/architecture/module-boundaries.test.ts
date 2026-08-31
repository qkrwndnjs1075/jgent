import { expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

const expectedSourceFiles = [
  "agent/agent-loop.ts",
  "agent/agent-run-coordinator.ts",
  "agent/agent-run-input.ts",
  "agent/agent-turn-executor.ts",
  "agent/index.ts",
  "auth/auth-error.ts",
  "auth/auth-provider.ts",
  "auth/credential-store.ts",
  "auth/credential.ts",
  "auth/environment-api-key-auth-provider.ts",
  "auth/index.ts",
  "compaction/compaction-policy.ts",
  "compaction/compactor.ts",
  "compaction/index.ts",
  "context/context-assembler.ts",
  "context/context-input.ts",
  "context/index.ts",
  "context/skill-instruction-profile.ts",
  "core/contracts/index.ts",
  "core/contracts/message.ts",
  "core/contracts/model.ts",
  "core/contracts/tool.ts",
  "core/index.ts",
  "harness/abort-scope.ts",
  "harness/active-run.ts",
  "harness/active-turn.ts",
  "harness/approval-executor.ts",
  "harness/budget-tracker.ts",
  "harness/contracts.ts",
  "harness/errors.ts",
  "harness/event-builder.ts",
  "harness/event-contracts.ts",
  "harness/event-writer.ts",
  "harness/execution-harness.ts",
  "harness/execution-scope.ts",
  "harness/index.ts",
  "harness/item-registry.ts",
  "harness/item-state.ts",
  "harness/item-types.ts",
  "harness/run-cleanup.ts",
  "harness/run-terminal.ts",
  "harness/tool-attempt.ts",
  "harness/tool-executor.ts",
  "harness/tool-failure.ts",
  "index.ts",
  "memory/index.ts",
  "memory/memory-candidate-extractor.ts",
  "memory/memory-policy.ts",
  "memory/memory-retriever.ts",
  "memory/memory-store-utils.ts",
  "memory/memory-store.ts",
  "memory/memory-write-summary.ts",
  "memory/memory-writer.ts",
  "memory/memory.ts",
  "memory/sqlite-memory-schema.ts",
  "memory/sqlite-memory-search.ts",
  "memory/sqlite-memory-store.ts",
  "model/index.ts",
  "model/model-client.ts",
  "model/model-error.ts",
  "model/model-input.ts",
  "model/model-transport.ts",
  "model/openai/openai-adapter.ts",
  "model/openai/openai-model-client.ts",
  "model/openai/openai-response.ts",
  "model/openai/openai-transport.ts",
  "model/openai/openai-types.ts",
  "model/provider-adapter.ts",
  "session/index.ts",
  "session/session-store.ts",
  "session/session.ts",
  "skill/errors.ts",
  "skill/index.ts",
  "skill/skill-loader.ts",
  "skill/skill-registry.ts",
  "skill/skill-resolver.ts",
  "skill/skill.ts",
  "tool/effect-digest.ts",
  "tool/index.ts",
  "tool/tool-registry.ts",
  "tool/tool-runtime.ts",
  "tool/tool-validator.ts",
  "workspace/index.ts",
  "workspace/tools/apply-patch.tool.ts",
  "workspace/tools/git-diff.tool.ts",
  "workspace/tools/git-status.tool.ts",
  "workspace/tools/grep.tool.ts",
  "workspace/tools/index.ts",
  "workspace/tools/list-directory.tool.ts",
  "workspace/tools/read-file.tool.ts",
  "workspace/tools/shell.tool.ts",
  "workspace/tools/write-file.tool.ts",
  "workspace/workspace-process.ts",
] as const

test("keeps the agent runtime dependency boundaries", async () => {
  // Given
  const sourceRoot = join(import.meta.dir, "../../src")

  // When
  const sourceFiles = await listSourceFiles(sourceRoot)
  const sourceContents = await Promise.all(
    sourceFiles.map(async (path) => ({
      path,
      contents: await readFile(join(sourceRoot, path), "utf8"),
    })),
  )

  // Then
  expect([...sourceFiles].sort()).toEqual([...expectedSourceFiles])
  expect(importsFrom(sourceContents, "model/").filter(reachesTool)).toEqual([])
  expect(importsFrom(sourceContents, "model/").filter(reachesContext)).toEqual([])
  expect(importsFrom(sourceContents, "model/").filter(reachesWorkspace)).toEqual([])
  expect(importsFrom(sourceContents, "model/").filter(reachesHarness)).toEqual([])
  expect(importsFrom(sourceContents, "tool/").filter(reachesModel)).toEqual([])
  expect(importsFrom(sourceContents, "tool/").filter(reachesContext)).toEqual([])
  expect(importsFrom(sourceContents, "tool/").filter(reachesWorkspace)).toEqual([])
  expect(importsFrom(sourceContents, "tool/").filter(reachesHarness)).toEqual([])
  expect(importsFrom(sourceContents, "tool/").filter(reachesSkill)).toEqual([])
  expect(importsFrom(sourceContents, "context/").filter(reachesTool)).toEqual([])
  expect(importsFrom(sourceContents, "context/").filter(reachesWorkspace)).toEqual([])
  expect(importsFrom(sourceContents, "context/").filter(reachesHarness)).toEqual([])
  expect(importsFrom(sourceContents, "workspace/").filter(reachesModel)).toEqual([])
  expect(importsFrom(sourceContents, "workspace/").filter(reachesContext)).toEqual([])
  expect(importsFrom(sourceContents, "workspace/").filter(reachesHarness)).toEqual([])
  expect(importsFrom(sourceContents, "workspace/").filter(reachesSkill)).toEqual([])
  expect(importsFrom(sourceContents, "harness/").filter(reachesModel)).toEqual([])
  expect(importsFrom(sourceContents, "harness/").filter(reachesContext)).toEqual([])
  expect(importsFrom(sourceContents, "harness/").filter(reachesWorkspace)).toEqual([])
  expect(importsFrom(sourceContents, "harness/").filter(reachesSkill)).toEqual([])
  expect(importsFrom(sourceContents, "skill/").filter(reachesTool)).toEqual([])
  expect(importsFrom(sourceContents, "skill/").filter(reachesHarness)).toEqual([])
  expect(importsFrom(sourceContents, "skill/").filter(reachesWorkspace)).toEqual([])
  expect(importsFrom(sourceContents, "skill/").filter(reachesModel)).toEqual([])
  expect(importsFrom(sourceContents, "skill/").filter(reachesContext)).toEqual([])
  expect(importsFrom(sourceContents, "agent/").filter(reachesContext)).toEqual([
    "../context/index.ts",
    "../context/index.ts",
    "../context/index.ts",
  ])
  expect(importsFrom(sourceContents, "agent/").filter(reachesHarness)).toEqual([
    "../harness/index.ts",
    "../harness/index.ts",
    "../harness/index.ts",
    "../harness/index.ts",
  ])
  expect(importsFrom(sourceContents, "agent/").filter(reachesSkill)).toEqual(["../skill/index.ts"])
})

async function listSourceFiles(
  directory: string,
  relativeDirectory = "",
): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = join(relativeDirectory, entry.name)
      if (entry.isDirectory()) {
        return listSourceFiles(join(directory, entry.name), relativePath)
      }
      return [relativePath]
    }),
  )
  return paths.flat()
}

function importsFrom(
  sourceFiles: readonly { readonly path: string; readonly contents: string }[],
  directory: string,
): readonly string[] {
  return sourceFiles
    .filter(({ path }) => path.startsWith(directory))
    .flatMap(({ contents }) => importSources(contents))
}

function importSources(contents: string): readonly string[] {
  const sources: string[] = []

  for (const match of contents.matchAll(/from "([^"]+)"/g)) {
    const source = match[1]
    if (source !== undefined) {
      sources.push(source)
    }
  }

  return sources
}

function reachesTool(source: string): boolean {
  return source.includes("/tool/") || source.endsWith("/tool")
}

function reachesContext(source: string): boolean {
  return source.includes("/context/") || source.endsWith("/context")
}

function reachesModel(source: string): boolean {
  return source.includes("/model/") || source.endsWith("/model")
}

function reachesWorkspace(source: string): boolean {
  return source.includes("/workspace/") || source.endsWith("/workspace")
}

function reachesHarness(source: string): boolean {
  return source.includes("/harness/") || source.endsWith("/harness")
}

function reachesSkill(source: string): boolean {
  return source.includes("/skill/") || source.endsWith("/skill")
}
