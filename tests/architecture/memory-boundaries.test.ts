import { expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

const forbiddenMemoryDependencies = [
  "/agent/",
  "/context/",
  "/harness/",
  "/model/",
  "/tool/",
  "/workspace/",
  "/skill/",
  "/compaction/",
] as const

test("keeps durable memory isolated from runtime authority and session state", async () => {
  // Given
  const sourceRoot = join(import.meta.dir, "../../src")
  const sourceFiles = await listSourceFiles(sourceRoot)
  const sourceContents = await Promise.all(
    sourceFiles.map(async (path) => ({
      path,
      contents: await readFile(join(sourceRoot, path), "utf8"),
    })),
  )

  // When
  const memoryImports = sourceContents
    .filter(({ path }) => path.startsWith("memory/"))
    .flatMap(({ contents }) => importSources(contents))
  const sessionImports = sourceContents
    .filter(({ path }) => path.startsWith("session/"))
    .flatMap(({ contents }) => importSources(contents))
  const memoryConsumers = sourceContents.filter(
    ({ path, contents }) =>
      !path.startsWith("memory/") && importSources(contents).some(reachesMemory),
  )

  // Then
  expect(memoryImports.filter(reachesForbiddenMemoryDependency)).toEqual([])
  expect(memoryImports.every(isAllowedMemoryDependency)).toBe(true)
  expect(sessionImports.filter(reachesMemory)).toEqual([])
  expect(memoryConsumers.every(({ path }) => isAllowedMemoryConsumer(path))).toBe(true)
  expect(memoryConsumers.map(({ path }) => path)).toContain("index.ts")
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

function importSources(contents: string): readonly string[] {
  const sources: string[] = []

  for (const match of contents.matchAll(/(?:from|export \* from) "([^"]+)"/g)) {
    const source = match[1]
    if (source !== undefined) {
      sources.push(source)
    }
  }

  return sources
}

function reachesMemory(source: string): boolean {
  return source.includes("/memory/") || source.endsWith("/memory")
}

function reachesForbiddenMemoryDependency(source: string): boolean {
  return forbiddenMemoryDependencies.some((dependency) => source.includes(dependency))
}

function isAllowedMemoryDependency(source: string): boolean {
  return (
    source === "zod" ||
    source === "node:crypto" ||
    source === "bun:sqlite" ||
    source === "../core/index.ts" ||
    source === "../session/index.ts" ||
    source.startsWith("./")
  )
}

function isAllowedMemoryConsumer(path: string): boolean {
  return path === "index.ts" || path.startsWith("agent/") || path.startsWith("context/")
}
