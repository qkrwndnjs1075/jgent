import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export class TestProcessError extends Error {
  readonly name = "TestProcessError"
}

export async function createTemporaryWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "jgent-workspace-tools-"))
}

export async function runGit(
  workspaceRoot: string,
  arguments_: readonly string[],
): Promise<string> {
  const process = Bun.spawn(["git", ...arguments_], {
    cwd: workspaceRoot,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [output, error, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])

  if (exitCode !== 0) {
    throw new TestProcessError(error)
  }

  return output
}
