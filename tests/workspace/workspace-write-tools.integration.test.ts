import { afterEach, describe, expect, test } from "bun:test"
import { readFile, realpath, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import nodeProcess from "node:process"
import {
  AjvToolValidator,
  createWorkspaceToolSet,
  ShellTool,
  ToolRuntime,
} from "../../src/index.ts"
import { createTemporaryWorkspace } from "./workspace-test-helpers.ts"

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
}> {
  const workspaceRoot = await createTemporaryWorkspace()
  temporaryDirectories.push(workspaceRoot)
  const toolSet = createWorkspaceToolSet(workspaceRoot)
  return {
    workspaceRoot,
    runtime: new ToolRuntime(toolSet.registry, new AjvToolValidator()),
  }
}

describe("workspace write and process tools", () => {
  test("writes a UTF-8 file relative to the workspace root", async () => {
    // Given
    const { workspaceRoot, runtime } = await createRuntime()

    // When
    const result = await runtime.execute({
      id: "call_write_file",
      name: "write_file",
      arguments: { path: "created.txt", content: "created by jgent" },
    })

    // Then
    expect(result).toEqual({
      toolCallId: "call_write_file",
      success: true,
      output: "Wrote file: created.txt",
    })
    expect(await readFile(join(workspaceRoot, "created.txt"), "utf8")).toBe("created by jgent")
  })

  test("applies a unified diff relative to the workspace root", async () => {
    // Given
    const { workspaceRoot, runtime } = await createRuntime()
    await writeFile(join(workspaceRoot, "message.txt"), "before\n", "utf8")
    const patch = [
      "diff --git a/message.txt b/message.txt",
      "--- a/message.txt",
      "+++ b/message.txt",
      "@@ -1 +1 @@",
      "-before",
      "+after",
      "",
    ].join("\n")

    // When
    const result = await runtime.execute({
      id: "call_apply_patch",
      name: "apply_patch",
      arguments: { patch },
    })

    // Then
    expect(result).toEqual({
      toolCallId: "call_apply_patch",
      success: true,
      output: "Applied patch",
    })
    expect(await readFile(join(workspaceRoot, "message.txt"), "utf8")).toBe("after\n")
  })

  test("runs a shell command from the workspace root", async () => {
    // Given
    const { workspaceRoot, runtime } = await createRuntime()
    await writeFile(join(workspaceRoot, "cwd.txt"), "workspace output\n", "utf8")

    // When
    const result = await runtime.execute({
      id: "call_shell",
      name: "shell",
      arguments: { command: "pwd && cat cwd.txt" },
    })

    // Then
    expect(result).toEqual({
      toolCallId: "call_shell",
      success: true,
      output: `${await realpath(workspaceRoot)}\nworkspace output\n`,
    })
  })

  test("returns stdout, stderr, and exit status when a shell command fails", async () => {
    // Given
    const { runtime } = await createRuntime()

    // When
    const result = await runtime.execute({
      id: "call_shell_failure",
      name: "shell",
      arguments: { command: "printf partial; printf problem >&2; exit 7" },
    })

    // Then
    expect(result).toEqual({
      toolCallId: "call_shell_failure",
      success: false,
      output: "partial",
      error: "Command exited with code 7\nproblem",
    })
  })

  test("terminates the shell process group when Tool execution is cancelled", async () => {
    // Given
    const workspaceRoot = await createTemporaryWorkspace()
    temporaryDirectories.push(workspaceRoot)
    const controller = new AbortController()
    const started = Promise.withResolvers<void>()
    const onStarted = (): void => started.resolve()
    nodeProcess.once("SIGUSR1", onStarted)
    const command = [
      "sleep 30 & echo $! > child.pid",
      `kill -USR1 ${nodeProcess.pid}`,
      "wait",
    ].join("; ")
    const execution = new ShellTool(workspaceRoot).execute(
      { command },
      { signal: controller.signal },
    )

    try {
      await started.promise

      // When
      controller.abort()
      const result = await execution

      // Then
      expect(result.success).toBe(false)
      const childPid = Number(await readFile(`${workspaceRoot}/child.pid`, "utf8"))
      expect(isProcessAlive(childPid)).toBe(false)
    } finally {
      nodeProcess.removeListener("SIGUSR1", onStarted)
    }
  }, 10_000)
})

function isProcessAlive(processId: number): boolean {
  try {
    nodeProcess.kill(processId, 0)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return false
    }
    throw error
  }
}
