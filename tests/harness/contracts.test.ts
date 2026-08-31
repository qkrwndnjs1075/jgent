import { expect, test } from "bun:test"
import {
  ApprovalIdSchema,
  AttemptIdSchema,
  AttemptNumberSchema,
  EffectDigestSchema,
  type EventSink,
  EventWriter,
  type HarnessEvent,
  ItemIdSchema,
  RunIdSchema,
  type RunOutcome,
  TurnIdSchema,
} from "../../src/index.ts"

test("accepts only positive integer attempt numbers and non-empty effect digests", () => {
  // Given
  const attemptId = crypto.randomUUID()

  // When
  const validAttempt = AttemptNumberSchema.safeParse(1)
  const invalidAttempt = AttemptNumberSchema.safeParse(0)
  const validId = AttemptIdSchema.safeParse(attemptId)
  const validDigest = EffectDigestSchema.safeParse("sha256:effect")

  // Then
  expect(validAttempt.success).toBe(true)
  expect(invalidAttempt.success).toBe(false)
  expect(validId.success).toBe(true)
  expect(validDigest.success).toBe(true)
})

test("retains a typed failure and display reason in a failed RunOutcome", () => {
  // Given
  const outcome: RunOutcome = {
    type: "failed",
    reason: "visible failure",
    displayReason: "visible failure",
    failure: {
      kind: "execution",
      message: "internal failure",
      displayReason: "visible failure",
      retryable: false,
    },
  }

  // When
  const failure = outcome.failure

  // Then
  expect(failure.kind).toBe("execution")
  expect(failure.displayReason).toBe("visible failure")
})

test("EventWriter assigns correlated attempt identity and monotonic sequence", async () => {
  // Given
  const runId = RunIdSchema.parse(crypto.randomUUID())
  const events: HarnessEvent[] = []
  const sink: EventSink = {
    emit: async (event) => {
      events.push(event)
    },
  }
  const writer = new EventWriter(runId, sink, () => 42)
  const attemptId = AttemptIdSchema.parse(crypto.randomUUID())

  // When
  await writer.emit({
    type: "model.started",
    turnId: TurnIdSchema.parse(crypto.randomUUID()),
    itemId: ItemIdSchema.parse(crypto.randomUUID()),
    attemptId,
    attempt: AttemptNumberSchema.parse(1),
  })
  await writer.emit({ type: "run.completed" })

  // Then
  expect(events.map(({ sequence }) => sequence)).toEqual([1, 2])
  expect(events.map(({ occurredAt }) => occurredAt)).toEqual([42, 42])
  const first = events[0]
  if (first === undefined || first.type !== "model.started") {
    throw new Error("Expected a model.started event")
  }
  expect(first.attemptId).toBe(attemptId)
})

test("keeps pre-effect Tool and approval events free of attempt correlation", async () => {
  // Given
  const runId = RunIdSchema.parse(crypto.randomUUID())
  const events: HarnessEvent[] = []
  const sink: EventSink = {
    emit: async (event) => {
      events.push(event)
    },
  }
  const writer = new EventWriter(runId, sink)
  const turnId = TurnIdSchema.parse(crypto.randomUUID())
  const itemId = ItemIdSchema.parse(crypto.randomUUID())
  const approvalId = ApprovalIdSchema.parse(crypto.randomUUID())
  const effectDigest = EffectDigestSchema.parse("sha256:effect")

  // When
  await writer.emit({
    type: "tool.requested",
    phase: "request",
    turnId,
    itemId,
    toolCallId: "call",
    toolName: "read",
  })
  await writer.emit({
    type: "tool.denied",
    phase: "authorization",
    turnId,
    itemId,
    toolCallId: "call",
    toolName: "read",
    reason: "denied",
  })
  await writer.emit({
    type: "approval.requested",
    turnId,
    itemId,
    approvalId,
    toolCallId: "call",
    toolName: "read",
    effectDigest,
  })
  await writer.emit({
    type: "approval.resolved",
    turnId,
    itemId,
    approvalId,
    toolCallId: "call",
    toolName: "read",
    effectDigest,
    approvalStatus: "approved",
  })

  // Then
  expect(events.every((event) => !("attemptId" in event))).toBe(true)
  expect(events.every((event) => !("attempt" in event))).toBe(true)
  const requested = events[2]
  const resolved = events[3]
  if (requested === undefined || resolved === undefined) {
    throw new Error("Expected approval events")
  }
  expect("effectDigest" in requested && requested.effectDigest).toBe(effectDigest)
  expect("effectDigest" in resolved && resolved.effectDigest).toBe(effectDigest)
})

test("requires approval identity and effect digest in broker result contracts", () => {
  // Given
  const approvalId = ApprovalIdSchema.parse(crypto.randomUUID())
  const effectDigest = EffectDigestSchema.parse("sha256:effect")

  // When
  const result = {
    approvalId,
    effectDigest,
    status: "approved" as const,
  }

  // Then
  expect(result.approvalId).toBe(approvalId)
  expect(result.effectDigest).toBe(effectDigest)
})

test("represents terminal EventSink delivery separately from the event", async () => {
  // Given
  const runId = RunIdSchema.parse(crypto.randomUUID())
  const sink: EventSink = {
    emit: async () => {
      throw new Error("sink unavailable")
    },
  }
  const writer = new EventWriter(runId, sink)

  // When
  const delivery = await writer.emitTerminal({ type: "run.completed" })

  // Then
  expect(delivery.status).toBe("failed")
  expect(delivery.event.type).toBe("run.completed")
  if (delivery.status !== "failed") {
    throw new Error("Expected terminal delivery to report a failure")
  }
  expect(delivery.failure.kind).toBe("event_sink")
})
