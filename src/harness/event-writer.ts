import type { EventDelivery, EventSink, HarnessEventDetails, RunId } from "./contracts.ts"
import { ExecutionEventSinkError } from "./errors.ts"
import { buildHarnessEvent, deliverHarnessEvent, type EventClock } from "./event-builder.ts"

export type { HarnessEventDetails } from "./contracts.ts"

export type TerminalHarnessEventType =
  | "run.completed"
  | "run.blocked"
  | "run.cancelled"
  | "run.failed"

export type TerminalEventDetails = Extract<
  HarnessEventDetails,
  { readonly type: TerminalHarnessEventType }
>

export class EventWriter {
  #sequence = 0
  #tail: Promise<void> = Promise.resolve()
  readonly #deliveryTimeoutMs: number

  constructor(
    private readonly runId: RunId,
    private readonly sink: EventSink,
    private readonly clock: EventClock = Date.now,
    deliveryTimeoutMs = 1_000,
  ) {
    this.#deliveryTimeoutMs = deliveryTimeoutMs
  }

  emit(details: HarnessEventDetails, signal?: AbortSignal): Promise<void> {
    return this.enqueue(async () => {
      const delivery = await this.deliver(details, signal)
      if (delivery.status === "failed") {
        throw new ExecutionEventSinkError(delivery.failure)
      }
    })
  }

  emitTerminal(details: TerminalEventDetails, signal?: AbortSignal): Promise<EventDelivery> {
    return this.enqueue(() => this.deliver(details, signal))
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.#tail.then(operation)
    this.#tail = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  private deliver(details: HarnessEventDetails, signal?: AbortSignal): Promise<EventDelivery> {
    const event = buildHarnessEvent(
      {
        runId: this.runId,
        sequence: this.nextSequence(),
        occurredAt: this.clock(),
      },
      details,
    )
    return deliverHarnessEvent(this.sink, event, signal, this.#deliveryTimeoutMs)
  }

  private nextSequence(): number {
    this.#sequence += 1
    return this.#sequence
  }
}
