export type ExecutionScopeState = "open" | "closing" | "closed"

export type ExecutionScopeOptions = {
  readonly parent?: AbortSignal
  readonly cleanupTimeoutMs?: number
}

export type ExecutionScopeCloseOptions = {
  readonly cancel?: boolean
  readonly timeoutMs?: number
}

export type ExecutionScopeCancelOptions = {
  readonly reason?: unknown
  readonly timeoutMs?: number
}

export type ExecutionScopeCloseResult =
  | { readonly type: "joined"; readonly pendingChildCount: 0 }
  | { readonly type: "cleanup_timeout"; readonly pendingChildCount: number }

export type ChildRegistration = {
  readonly release: () => void
  readonly track: <T>(promise: Promise<T>) => Promise<T>
}

export class ExecutionScopeClosedError extends Error {
  readonly name = "ExecutionScopeClosedError"

  constructor(readonly state: "closing" | "closed") {
    super(`Execution scope is ${state}`)
  }
}

export class InvalidExecutionScopeTimeoutError extends Error {
  readonly name = "InvalidExecutionScopeTimeoutError"

  constructor(readonly timeoutMs: number) {
    super("Execution scope cleanup timeout must be a finite non-negative number")
  }
}

export class ExecutionScope {
  static readonly defaultCleanupTimeoutMs = 1_000

  readonly #controller = new AbortController()
  readonly #parent: AbortSignal | undefined
  readonly #parentAbortHandler: (() => void) | undefined
  readonly #cleanupTimeoutMs: number
  readonly #children = new Set<symbol>()
  readonly #idleWaiters = new Set<() => void>()
  #state: ExecutionScopeState = "open"
  #closePromise: Promise<ExecutionScopeCloseResult> | undefined

  constructor(options: ExecutionScopeOptions = {}) {
    this.#parent = options.parent
    this.#cleanupTimeoutMs = normalizeTimeout(
      options.cleanupTimeoutMs,
      ExecutionScope.defaultCleanupTimeoutMs,
    )

    if (this.#parent === undefined) {
      return
    }

    const onParentAbort = (): void => {
      this.#controller.abort(this.#parent?.reason)
    }
    this.#parentAbortHandler = onParentAbort
    if (this.#parent.aborted) {
      onParentAbort()
    } else {
      this.#parent.addEventListener("abort", onParentAbort, { once: true })
    }
  }

  get signal(): AbortSignal {
    return this.#controller.signal
  }

  get state(): ExecutionScopeState {
    return this.#state
  }

  get childCount(): number {
    return this.#children.size
  }

  registerChild(): ChildRegistration {
    this.ensureOpen()
    const token = Symbol("execution-child")
    this.#children.add(token)
    let released = false

    const release = (): void => {
      if (released) {
        return
      }
      released = true
      this.#children.delete(token)
      if (this.#children.size === 0) {
        const waiters = [...this.#idleWaiters]
        for (const waiter of waiters) {
          waiter()
        }
      }
    }

    const track = <T>(promise: Promise<T>): Promise<T> => {
      const tracked = promise.then(
        (value) => {
          release()
          return value
        },
        (reason: unknown) => {
          release()
          throw reason
        },
      )
      void tracked.catch(() => undefined)
      return tracked
    }

    return { release, track }
  }

  track<T>(promise: Promise<T>): Promise<T> {
    const registration = this.registerChild()
    return registration.track(promise)
  }

  spawn<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const registration = this.registerChild()
    let child: Promise<T>
    try {
      child = Promise.resolve(operation(this.signal))
    } catch (error) {
      child = Promise.reject(error)
    }
    return registration.track(child)
  }

  cancel(reason?: unknown): void {
    if (!this.#controller.signal.aborted) {
      this.#controller.abort(reason)
    }
  }

  cancelAndJoin(options: ExecutionScopeCancelOptions = {}): Promise<ExecutionScopeCloseResult> {
    if (options.reason === undefined) {
      this.cancel()
    } else {
      this.cancel(options.reason)
    }

    if (options.timeoutMs === undefined) {
      return this.close({ cancel: true })
    }
    return this.close({ cancel: true, timeoutMs: options.timeoutMs })
  }

  close(options: ExecutionScopeCloseOptions = {}): Promise<ExecutionScopeCloseResult> {
    if (this.#closePromise !== undefined) {
      return this.#closePromise
    }

    const timeoutMs = normalizeTimeout(options.timeoutMs, this.#cleanupTimeoutMs)
    if (options.cancel === true) {
      this.cancel()
    }
    this.#state = "closing"
    this.#closePromise = this.join(timeoutMs)
    return this.#closePromise
  }

  private ensureOpen(): void {
    if (this.#state !== "open") {
      throw new ExecutionScopeClosedError(this.#state)
    }
  }

  private join(timeoutMs: number): Promise<ExecutionScopeCloseResult> {
    if (this.#children.size === 0) {
      return Promise.resolve(this.finish({ type: "joined", pendingChildCount: 0 }))
    }

    return new Promise<ExecutionScopeCloseResult>((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      const finish = (result: ExecutionScopeCloseResult): void => {
        if (timeout !== undefined) {
          clearTimeout(timeout)
        }
        this.#idleWaiters.delete(onIdle)
        resolve(this.finish(result))
      }
      const onIdle = (): void => {
        if (this.#children.size === 0) {
          finish({ type: "joined", pendingChildCount: 0 })
        }
      }

      this.#idleWaiters.add(onIdle)
      timeout = setTimeout(() => {
        finish({ type: "cleanup_timeout", pendingChildCount: this.#children.size })
      }, timeoutMs)
      onIdle()
    })
  }

  private finish(result: ExecutionScopeCloseResult): ExecutionScopeCloseResult {
    this.#state = "closed"
    if (this.#parent !== undefined && this.#parentAbortHandler !== undefined) {
      this.#parent.removeEventListener("abort", this.#parentAbortHandler)
    }
    return result
  }
}

function normalizeTimeout(value: number | undefined, fallback: number): number {
  const timeoutMs = value ?? fallback
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new InvalidExecutionScopeTimeoutError(timeoutMs)
  }
  return timeoutMs
}
