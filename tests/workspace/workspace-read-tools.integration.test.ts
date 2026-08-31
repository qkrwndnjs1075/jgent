import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { AjvToolValidator, createWorkspaceToolSet, ToolRuntime } from "../../src/index.ts"
import { createTemporaryWorkspace, runGit } from "./workspace-test-helpers.ts"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function createRuntime(): Promise<{
  readonly workspaceRoot: string
  readonly runtime: ToolRuntime
  readonly definitions: readonly { readonly name: string }[]
}> {
  const workspaceRoot = await createTemporaryWorkspace()
  temporaryDirectories.push(workspaceRoot)
  const toolSet = createWorkspaceToolSet(workspaceRoot)
  return {
    workspaceRoot,
    runtime: new ToolRuntime(toolSet.registry, new AjvToolValidator()),
    definitions: toolSet.definitions,
  }
}

describe("workspace read tools", () => {
  test("registers all eight workspace tool definitions in the intended order", async () => {
    // Given
    const { definitions } = await createRuntime()

    // When
    const names = definitions.map(({ name }) => name)

    // Then
    expect(names).toEqual([
      "read_file",
      "list_directory",
      "grep",
      "git_status",
      "git_diff",
      "write_file",
      "apply_patch",
      "shell",
    ])
  })

  test("reads a UTF-8 file relative to the workspace root", async () => {
    // Given
    const { workspaceRoot, runtime } = await createRuntime()
    await writeFile(join(workspaceRoot, "package.json"), '{ "name": "jgent" }', "utf8")

    // When
    const result = await runtime.execute({
      id: "call_read_file",
      name: "read_file",
      arguments: { path: "package.json" },
    })

    // Then
    expect(result).toEqual({
      toolCallId: "call_read_file",
      success: true,
      output: '{ "name": "jgent" }',
    })
  })

  test("lists files and directories in stable name order", async () => {
    // Given
    const { workspaceRoot, runtime } = await createRuntime()
    await mkdir(join(workspaceRoot, "src"))
    await writeFile(join(workspaceRoot, "README.md"), "read me", "utf8")

    // When
    const result = await runtime.execute({
      id: "call_list_directory",
      name: "list_directory",
      arguments: { path: "." },
    })

    // Then
    expect(result).toEqual({
      toolCallId: "call_list_directory",
      success: true,
      output: "file\tREADME.md\ndirectory\tsrc",
    })
  })

  test("finds matching source lines with paths and line numbers", async () => {
    // Given
    const { workspaceRoot, runtime } = await createRuntime()
    await mkdir(join(workspaceRoot, "src"))
    await writeFile(
      join(workspaceRoot, "src/user-service.ts"),
      "export class UserService {}\n",
      "utf8",
    )

    // When
    const result = await runtime.execute({
      id: "call_grep",
      name: "grep",
      arguments: { query: "UserService", path: "src" },
    })

    // Then
    expect(result).toEqual({
      toolCallId: "call_grep",
      success: true,
      output: "src/user-service.ts:1:export class UserService {}\n",
    })
  })

  test("returns the short Git worktree status from the workspace root", async () => {
    // Given
    const { workspaceRoot, runtime } = await createRuntime()
    await runGit(workspaceRoot, ["init", "--quiet"])
    await writeFile(join(workspaceRoot, "note.txt"), "untracked", "utf8")

    // When
    const result = await runtime.execute({
      id: "call_git_status",
      name: "git_status",
      arguments: {},
    })

    // Then
    expect(result).toEqual({
      toolCallId: "call_git_status",
      success: true,
      output: "?? note.txt\n",
    })
  })

  test("returns the unstaged Git diff from the workspace root", async () => {
    // Given
    const { workspaceRoot, runtime } = await createRuntime()
    await runGit(workspaceRoot, ["init", "--quiet"])
    await runGit(workspaceRoot, ["config", "user.email", "jgent@example.test"])
    await runGit(workspaceRoot, ["config", "user.name", "Jgent Test"])
    await writeFile(join(workspaceRoot, "tracked.txt"), "before\n", "utf8")
    await runGit(workspaceRoot, ["add", "tracked.txt"])
    await runGit(workspaceRoot, ["commit", "--quiet", "-m", "baseline"])
    await writeFile(join(workspaceRoot, "tracked.txt"), "after\n", "utf8")

    // When
    const result = await runtime.execute({
      id: "call_git_diff",
      name: "git_diff",
      arguments: {},
    })

    // Then
    expect(result).toMatchObject({
      toolCallId: "call_git_diff",
      success: true,
      output: expect.stringContaining("-before\n+after"),
    })
  })

  test("rejects additional arguments before executing a no-input Git tool", async () => {
    // Given
    const { runtime } = await createRuntime()

    // When
    const result = await runtime.execute({
      id: "call_invalid_no_input",
      name: "git_status",
      arguments: { unexpected: true },
    })

    // Then
    expect(result.success).toBe(false)
  })
})
