import { expect, test } from "bun:test"
import { readFile, rm } from "node:fs/promises"
import nodeProcess from "node:process"
import { executeWorkspaceProcess } from "../../src/workspace/workspace-process.ts"
import { createTemporaryWorkspace } from "./workspace-test-helpers.ts"

test("escalates an abort from process-group SIGTERM to SIGKILL and awaits exit", async () => {
  // Given
  const workspaceRoot = await createTemporaryWorkspace()
  const controller = new AbortController()
  const started = Promise.withResolvers<void>()
  const onStarted = (): void => started.resolve()
  nodeProcess.once("SIGUSR1", onStarted)
  const command = [
    "trap '' TERM",
    "sleep 30 & child=$!",
    "echo $child > child.pid",
    `kill -USR1 ${nodeProcess.pid}`,
    "wait",
  ].join("; ")

  try {
    const execution = executeWorkspaceProcess(
      { command: ["/bin/sh", "-c", command], cwd: workspaceRoot },
      { signal: controller.signal, cleanup: { graceMs: 20 } },
    )
    await started.promise

    // When
    controller.abort()
    const result = await execution

    // Then
    expect(result.exitCode).not.toBe(0)
    const childPid = Number(await readFile(`${workspaceRoot}/child.pid`, "utf8"))
    expect(isProcessAlive(childPid)).toBe(false)
  } finally {
    nodeProcess.removeListener("SIGUSR1", onStarted)
    await rm(workspaceRoot, { recursive: true, force: true })
  }
}, 10_000)

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
