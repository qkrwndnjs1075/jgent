import type {
  EventDelivery,
  EventSink,
  HarnessEvent,
  HarnessEventDetails,
  RunId,
} from "./contracts.ts"
import { ExecutionEventSinkError, ExecutionInvariantError } from "./errors.ts"

export type EventClock = () => number

export type EventEnvelope = {
  readonly runId: RunId
  readonly sequence: number
  readonly occurredAt: number
}

export function buildHarnessEvent(
  envelope: EventEnvelope,
  details: HarnessEventDetails,
): HarnessEvent {
  return { ...envelope, ...details }
}

export async function deliverHarnessEvent(
  sink: EventSink,
  event: HarnessEvent,
  signal: AbortSignal | undefined,
  timeoutMs?: number,
): Promise<EventDelivery> {
  const delivery = createDeliverySignal(signal, timeoutMs)
  try {
    if (delivery.signal === undefined) {
      await sink.emit(event)
    } else {
      await runAbortableSink(sink, event, delivery.signal)
    }
    return { status: "delivered", event }
  } catch (error) {
    if (error instanceof ExecutionEventSinkError) {
      return { status: "failed", event, failure: error.failure }
    }
    const sinkError = new ExecutionEventSinkError(error)
    return { status: "failed", event, failure: sinkError.failure }
  } finally {
    delivery.dispose()
  }
}

type DeliverySignal = {
  readonly signal: AbortSignal | undefined
  readonly dispose: () => void
}

function createDeliverySignal(
  parent: AbortSignal | undefined,
  timeoutMs: number | undefined,
): DeliverySignal {
  if (timeoutMs === undefined) {
    return { signal: parent?.aborted === true ? undefined : parent, dispose: () => undefined }
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const onParentAbort = (): void => controller.abort(parent?.reason)
  if (parent !== undefined && !parent.aborted) {
    parent.addEventListener("abort", onParentAbort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout)
      parent?.removeEventListener("abort", onParentAbort)
    },
  }
}

function runAbortableSink(
  sink: EventSink,
  event: HarnessEvent,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason)
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => signal.removeEventListener("abort", onAbort)
    const settle = (callback: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      callback()
    }
    const onAbort = (): void => settle(() => reject(signal.reason))
    signal.addEventListener("abort", onAbort, { once: true })
    sink.emit(event, signal).then(
      () => settle(resolve),
      (error: unknown) => settle(() => reject(error)),
    )
  })
}

export function assertNeverEvent(value: never): never {
  throw new ExecutionInvariantError(`Unexpected Harness event: ${String(value)}`)
}
