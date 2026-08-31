import nodeProcess from "node:process"
import type { ToolExecutionContext } from "../core/index.ts"

const DEFAULT_TERMINATION_GRACE_MS = 250
const DEFAULT_CLEANUP_TIMEOUT_MS = 5_000

export type WorkspaceProcessRequest = {
  readonly command: string[]
  readonly cwd: string
  readonly stdin?: string
}

export type WorkspaceProcessResult = {
  readonly output: string
  readonly error: string
  readonly exitCode: number
}

export type WorkspaceProcessCleanupContext = {
  readonly graceMs?: number
  readonly cleanupTimeoutMs?: number
}

export type WorkspaceProcessContext = ToolExecutionContext &
  WorkspaceProcessCleanupContext & {
    readonly cleanup?: WorkspaceProcessCleanupContext
  }

export type WorkspaceProcessOptions = WorkspaceProcessCleanupContext

export async function executeWorkspaceProcess(
  request: WorkspaceProcessRequest,
  context?: WorkspaceProcessContext,
  options?: WorkspaceProcessOptions,
): Promise<WorkspaceProcessResult> {
  const signal = context?.signal ?? new AbortController().signal
  signal.throwIfAborted()
  const cleanup = resolveCleanupContext(context, options)
  const subprocess = Bun.spawn(request.command, {
    cwd: request.cwd,
    detached: true,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  subprocess.unref()

  let exited = false
  let terminationRequested = false
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  let terminationError: Error | undefined
  const markExited = (): void => {
    exited = true
    clearTimeout(graceTimer)
    graceTimer = undefined
  }
  const exit = subprocess.exited.then(
    (exitCode) => {
      markExited()
      return exitCode
    },
    (error: unknown) => {
      markExited()
      throw error
    },
  )
  const terminate = (): void => {
    if (terminationRequested || exited) {
      return
    }
    terminationRequested = true
    terminationError ??= terminateProcessGroup(subprocess.pid, "SIGTERM")
    graceTimer = setTimeout(() => {
      graceTimer = undefined
      if (!exited) {
        const killError = terminateProcessGroup(subprocess.pid, "SIGKILL")
        terminationError ??= killError
      }
    }, cleanup.graceMs)
  }
  const output = new Response(subprocess.stdout).text()
  const error = new Response(subprocess.stderr).text()
  const result = Promise.all([output, error, exit])

  try {
    if (request.stdin !== undefined) {
      subprocess.stdin.write(request.stdin)
    }
    subprocess.stdin.end()
    const [outputText, errorText, exitCode] = await awaitProcessResult(
      result,
      signal,
      cleanup.cleanupTimeoutMs,
      terminate,
    )
    if (terminationError !== undefined) {
      throw terminationError
    }
    return { output: outputText, error: errorText, exitCode }
  } catch (caught) {
    if (!exited && !(caught instanceof WorkspaceProcessCleanupTimeoutError)) {
      terminate()
      await waitForExit(exit, cleanup.cleanupTimeoutMs)
    }
    throw caught
  } finally {
    clearTimeout(graceTimer)
  }
}

function resolveCleanupContext(
  context: WorkspaceProcessContext | undefined,
  options: WorkspaceProcessOptions | undefined,
): Required<WorkspaceProcessCleanupContext> {
  return {
    graceMs:
      options?.graceMs ??
      context?.cleanup?.graceMs ??
      context?.graceMs ??
      DEFAULT_TERMINATION_GRACE_MS,
    cleanupTimeoutMs:
      options?.cleanupTimeoutMs ??
      context?.cleanup?.cleanupTimeoutMs ??
      context?.cleanupTimeoutMs ??
      DEFAULT_CLEANUP_TIMEOUT_MS,
  }
}

function awaitProcessResult<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
  onAbort: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const cleanup = (): void => {
      signal.removeEventListener("abort", handleAbort)
      clearTimeout(timeout)
    }
    const finish = (settlement: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      settlement()
    }
    const handleAbort = (): void => {
      if (settled) {
        return
      }
      onAbort()
      timeout = setTimeout(
        () => finish(() => reject(new WorkspaceProcessCleanupTimeoutError(timeoutMs))),
        timeoutMs,
      )
    }

    signal.addEventListener("abort", handleAbort, { once: true })
    if (signal.aborted) {
      handleAbort()
    }
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

async function waitForExit(operation: Promise<number>, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      reject(new WorkspaceProcessCleanupTimeoutError(timeoutMs))
    }, timeoutMs)
    operation.then(
      () => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeout)
        resolve()
      },
      (error: unknown) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

export class WorkspaceProcessTerminationError extends Error {
  readonly name = "WorkspaceProcessTerminationError"

  constructor(error: unknown) {
    super("Failed to terminate workspace process group", { cause: error })
  }
}

export class WorkspaceProcessCleanupTimeoutError extends Error {
  readonly name = "WorkspaceProcessCleanupTimeoutError"

  constructor(readonly timeoutMs: number) {
    super(`Workspace process did not exit within ${timeoutMs}ms after termination`)
  }
}

function terminateProcessGroup(processGroupId: number, signal: NodeJS.Signals): Error | undefined {
  try {
    nodeProcess.kill(-processGroupId, signal)
    return undefined
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return undefined
    }
    return new WorkspaceProcessTerminationError(error)
  }
}
