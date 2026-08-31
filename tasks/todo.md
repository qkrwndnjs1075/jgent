# Stage 10 Memory Implementation (Completed)

## Specification

- [x] Persist only policy-approved durable knowledge after a successful Run.
- [x] Keep Memory outside canonical Session history and compaction state.
- [x] Enforce workspace, user, and workspace-user scope isolation.
- [x] Prevent exact duplicates atomically and supersede mutable preferences by subject.
- [x] Retrieve one bounded deterministic Memory projection per Run.
- [x] Bind continuation validity to the exact retrieved Memory projection.
- [x] Preserve byte-for-byte Agent behavior when Memory is unconfigured or empty.
- [x] Prove durable SQLite recovery across Store instances.

## Plan

- [x] Refactor AgentLoop orchestration without changing existing behavior.
- [x] Implement Memory types, policy, Stores, Writer, and Retriever with failing-first tests.
- [x] Integrate Run-scoped retrieval, ContextAssembler projection, and continuation binding.
- [x] Integrate successful-Run writing from the immutable completed-Run delta.
- [x] Update exports, architecture boundaries, and Stage 10 integration/E2E coverage.
- [x] Run the full automated gate, no-excuse/LOC audit, and public API manual QA.

## Review

- Added `src/memory/` contracts, conservative policy, explicit candidate extractor, atomic in-memory
  Store, file-backed Bun SQLite/FTS5 Store, bounded lexical retriever, and policy-governed Writer.
- `AgentLoop` retrieves exactly once inside the exclusive Run before user persistence, injects a
  transient Memory data block through `ContextAssembler`, binds its fingerprint to continuation,
  and writes only the immutable completed Run delta after the final assistant checkpoint.
- Memory is never added to canonical Session messages or compaction state. Empty and unconfigured
  Memory preserve the existing model input shape; configured Store/retrieval/write failures remain
  typed failures rather than silently degrading to empty context.
- Scope visibility is explicit for workspace, user, and workspace-user records; exact duplicates
  are atomic and preference subjects supersede active values. SQLite restart and two-connection
  dedupe are covered by integration tests.
- Final automated gate: `bun run check` passed with 210 tests and 602 assertions. The no-excuse
  TypeScript audit passed for 29 files, Biome passed, and all production LOC limits passed; the
  existing `src/session/session.ts` remains at 211 pure LOC in its prior warning band.
- Public QA passed: repeated two-Run SQLite close/reopen retrieval, canonical transcript isolation,
  failed Run no-write behavior, changed Memory continuation clearing, and malicious Memory Harness
  denial. No visual QA claim applies to this library-only change.
- LSP diagnostics timed out on the shared daemon; strict `tsc --noEmit` is clean and the limitation
  is recorded at `.omo/evidence/stage10/final/lsp.md`.
- The checkout remains intentionally all-untracked except `README.md`; no commit was created.

---

# Stage 10 Memory Architecture Review (Completed)

## Specification

- [x] Preserve the boundary between canonical Session history and cross-Run durable Memory.
- [x] Define policy-governed extraction with sensitivity and duplicate rejection.
- [x] Define workspace/user scope and provenance semantics.
- [x] Retrieve only task-relevant bounded Memory before ContextAssembler input is rendered.
- [x] Preserve normal Agent behavior when Memory is absent or unavailable by design.

## Plan

- [x] Inspect current Session, AgentLoop, ContextAssembler, and continuation contracts with CodeGraph.
- [x] Audit the proposed Memory contracts and identify required corrections.
- [x] Define the smallest Stage 10 vertical slice and explicit deferred scope.
- [x] Reconcile completion criteria with existing public API and architecture tests.

## Review

- Keep the four responsibilities: `MemoryStore`, `MemoryWriter`, `MemoryRetriever`, and
  `MemoryPolicy`. Memory remains a separate durable projection and is never appended to canonical
  Session messages or compaction state.
- The current runtime has no Session-finalization lifecycle; one Session is reused across Runs.
  Stage 10 therefore writes only after a successful Run has checkpointed its final assistant
  message. Failed or cancelled Runs do not produce Memory.
- `MemoryWriter` consumes an immutable completed-Run slice plus its final Session revision and
  scope, not a live `AgentSession` or its complete history. This makes provenance and idempotence
  explicit and prevents each Run from re-extracting every older message.
- Scope is a discriminated union for workspace, user, or workspace-user visibility. Unscoped global
  Memory is not part of v1, and retrieval carries both workspace and user identity when available.
- Provenance includes branded Session ID, final source revision, and the covered canonical message
  range. Content and tags are bounded before entering the Store.
- `MemoryPolicy` is a pure, conservative allowlist decision over durability, generalizability, and
  sensitivity. Raw history, Tool output, secrets, credentials, tokens, and transient task state are
  rejected. Exact duplicate enforcement is a Store responsibility, not a search-then-put Writer
  check.
- Candidate extraction must be explicit. A model-backed extractor is a governed Harness Model Item
  with budgets, cancellation, and events; it must not make a hidden post-Run model call. Until that
  auxiliary lifecycle exists, v1 uses an injected deterministic extractor or explicit candidates.
- `MemoryStore` atomically inserts by a stable digest of kind, normalized content, and scope and
  returns inserted-or-duplicate. This prevents concurrent Writers from racing. Semantic duplicate
  detection remains deferred. A stable subject key is required for mutable preferences so a newer
  value supersedes the older one instead of allowing contradictory active records.
- `MemoryRetriever` performs one bounded, deterministic lexical retrieval per Run before the user
  message checkpoint. It returns an immutable ordered set that is reused for every Turn in that
  Run. Empty or unconfigured Memory preserves current behavior.
- `ContextAssembler` renders retrieved Memory as a clearly delimited data block in the transient
  model-visible view. The block is never persisted to Session and never grants Tool capability.
- Retrieved Memory changes the model-visible message projection and OpenAI continuation cursor.
  Bind continuation validity to the exact rendered Memory fingerprint and atomically clear a stale
  continuation with the next user-message checkpoint, just as Stage 9 does for instructions.
- Implement an in-memory Store for contract tests and a SQLite Store with text search for actual
  restart durability. Vector search, embeddings, reranking, semantic deduplication, decay, and
  cross-device synchronization remain deferred.
- Split Run-context/Turn orchestration before adding Memory because `src/agent/agent-loop.ts` is
  already in the 200-250 pure-LOC warning band. Update root exports and the exact source/dependency
  allowlist when `src/memory/*` and the extracted Agent module are added.
- Required implementation proof: policy rejection, exact atomic deduplication, workspace/user
  isolation, deterministic top-k retrieval, successful-Run-only writes, restart persistence,
  byte-for-byte empty-Memory compatibility, Run-stable retrieval, continuation invalidation, and a
  malicious-Memory Harness-denial integration scenario.

---

# Stage 9 Skills Implementation

## Specification

- [x] Load bounded, non-executable SKILL.md files from a contained workspace Skill root.
- [x] Register immutable Skills with unique branded identities and content digests.
- [x] Resolve at most three relevant Skills deterministically once per Run.
- [x] Assemble one stable instruction profile per Model request without persisting Skills in Session history.
- [x] Invalidate stale continuation when the effective instruction profile changes.
- [x] Preserve existing behavior when Skills are absent and preserve Stage 7 Tool governance.

## Plan

- [x] Implement Skill contracts, Loader, Registry, and Resolver with failing-first tests.
- [x] Add provider-neutral instructions to ModelInput and ContextAssembler.
- [x] Integrate Run-scoped resolution and instruction fingerprint with AgentLoop and Session.
- [x] Update exports, topology, and focused/integration regression coverage.
- [x] Run the full automated gate, TypeScript no-excuse/LOC audit, and public API QA.

## Review

- `src/skill/` now owns strict SKILL.md parsing, workspace/realpath containment, byte/count
  limits, fatal UTF-8 decoding, immutable registration, duplicate rejection, branded digests,
  and synchronous deterministic lexical selection of at most three Skills.
- AgentLoop resolves Skills exactly once while holding the Session run lease and reuses one
  immutable instruction profile for every Turn. Resolver failure occurs before user-message
  persistence; Skills are never checkpointed into canonical Session history.
- Context assembly emits one provider-neutral instruction block ordered as system, resolved
  project/AGENTS rules, then selected Skills. Its SHA-256 fingerprint covers the exact rendered
  profile, and OpenAI requests resend instructions independently of the transcript cursor.
- Session continuations bind both context view and instruction fingerprint. A changed profile is
  cleared atomically with the next user message before model execution, including failed Runs.
- Skill modules cannot import Harness/ToolRuntime/workspace/model/context. A malicious Skill
  integration scenario still reaches CapabilityPolicy denial and never reaches Sandbox or Tool
  execution.
- Agent run-input/session resolution moved to `src/agent/agent-run-input.ts` with focused branch
  coverage, keeping AgentLoop at 243 pure LOC instead of crossing the 250-line ceiling.
- `bun run check` passed: Biome clean, strict TypeScript clean, 154 tests and 429 assertions.
  The TypeScript no-excuse audit reported no violations in 26 changed files.
- Public API QA loaded a real temporary `.my-agent/skills/testing/SKILL.md`, selected it, observed
  instruction layer order `system -> project -> skill`, completed `SKILL_QA_OK`, and confirmed the
  Session contained only `user -> assistant` messages.
- LSP diagnostics remained unavailable because the host mise shim has no configured
  `typescript-language-server`; strict `tsc --noEmit` passed through the full gate.
- Warning band: `src/agent/agent-loop.ts` is 243 pure LOC, `src/session/session.ts` is 206, and two
  touched tests are above 200. Split AgentLoop turn execution before adding another concern.

---

# Stage 9 Skills / Stage 10 Memory Split Architecture Review (Completed)

## Specification

- [x] Verify that Skills and Memory have different responsibilities and lifecycles.
- [x] Locate the Stage 9 insertion points in AgentLoop, ContextAssembler, Session, and Harness.
- [x] Review the proposed Skill and SkillResolver contracts for continuation and trust-boundary gaps.
- [x] Define the smallest corrected Stage 9 scope without pulling persistent Memory forward.

## Plan

- [x] Inspect the current Stage 6-8 request flow with CodeGraph.
- [x] Audit roadmap, module-boundary tests, and workspace-root ownership.
- [x] Audit Skill selection, instruction assembly, continuation identity, and Harness non-bypass.
- [x] Record an evidence-backed recommendation and completion criteria.

## Review

- Split the roadmap into Stage 9 Skills and Stage 10 Memory. Skills are authored task-scoped
  procedures selected for a Run; Memory is learned durable state spanning Runs or Sessions. Their
  ownership, mutation, persistence, and trust rules are different enough to require separate stages.
- Resolve Skills exactly once per Run from an immutable Registry, keep the ordered snapshot stable
  across every Turn, and pass it to ContextAssembler. Do not perform filesystem or model-backed
  resolution from ContextAssembler, which is called again on every model/tool round.
- Add an explicit workspace root to AgentLoop composition. The current Loop has no cwd contract;
  workspace Tools currently receive their root through a separate composition seam.
- Do not append Skill instructions to canonical Session history. Assemble them as a dedicated,
  delimited instruction layer with fixed precedence: system, project/AGENTS rules, current user
  goal, then selected Skill procedures.
- Bind continuation validity to the complete instruction profile, including ordered Skill IDs and
  content digests. The current contextViewId changes for compaction, not for a different Skill set,
  so a new Run can otherwise reuse a continuation created under stale instructions.
- Keep the v1 Resolver deterministic and local. A future model-backed Resolver must execute as a
  Harness-governed Model Item with budgets, cancellation, and events rather than making a hidden
  model call.
- Loader requirements are part of Stage 9: canonical-root containment, symlink escape rejection,
  strict frontmatter parsing, duplicate-ID rejection, byte/count limits, deterministic ordering,
  immutable snapshots, and no executable module loading.
- Skill absence is a normal empty result; malformed, duplicate, or escaping Skill files are typed
  failures and must not silently degrade to an empty set.
- Skill content never grants capabilities. Tool calls remain governed by preparation, capability
  policy, approval, sandbox, and immutable execution in Stage 7 Harness.
- Add Stage 9 tests for load/register/resolve, max-three deterministic selection, exactly-once
  instruction assembly, empty-Skill compatibility, continuation invalidation on instruction-profile
  change, and Harness non-bypass. Update the exact source allowlist when src/skill is added.

---

# Stage 7 Execution Harness Proposal Second Opinion (Completed)

# Stage 8 Session / Compaction Architecture Review (Completed)

## Specification

- [x] Compare the proposed Session boundary with the current AgentLoop and continuation flow.
- [x] Define canonical-history, resume, and compaction-view invariants without mixing Harness events.
- [x] Identify the smallest Stage 8 contract that remains replaceable by durable stores later.

## Plan

- [x] Inspect the active flow through AgentLoop, ContextAssembler, and ModelContinuation.
- [x] Audit Session and SessionStore ownership, concurrency, and failure semantics.
- [x] Audit CompactionPolicy, Compactor, summary provenance, and recent-tail semantics.
- [x] Record an evidence-backed recommendation and concrete contract adjustments.

## Review

- The Stage 8 boundary is correct: Session owns canonical model-visible history and resumable state;
  Compaction owns a derived context view; Harness events remain a separate execution record.
- Replace separate message/continuation getters and writes with an immutable SessionSnapshot and
  revision-checked atomic checkpoint. A checkpoint must support continuation replace and clear,
  and the same Session must reject or serialize concurrent Runs.
- AgentLoop must persist the user request before model execution and persist the final assistant
  response plus completed continuation before returning success. The current completed branch
  drops both from future history.
- Bind continuation to the exact context view that produced it. Creating a new compaction
  checkpoint changes that view and must clear the prior continuation atomically; the current
  consumedMessageCount cursor cannot safely index both canonical and compacted arrays.
- Compaction state is noncanonical provenance: summary, stable view identity, and a safe covered
  message boundary. Recent history is derived from the canonical suffix and must never split an
  assistant Tool-call bundle from its correlated Tool results.
- A model-backed Compactor must execute through a Harness-governed model Item/Attempt with budget,
  timeout, cancellation, and events. It must not make an untracked model call from ContextAssembler.
- InMemorySessionStore proves same-process create/load/resume only. Durable restart resume remains
  deferred to FileSessionStore or SQLiteSessionStore; exactly-once recovery across a crash during
  an external Tool effect also remains outside this Stage.
- Recommended order: atomic Session/store -> complete transcript persistence -> uncompressed
  resume -> compaction checkpoint/provenance -> continuation invalidation -> low-threshold public
  API QA.

---

# Stage 8 Session / Compaction Implementation

## Specification

- [x] Add immutable SessionSnapshot and revision-checked atomic checkpointing.
- [x] Add InMemorySessionStore with same-session exclusive Run ownership.
- [x] Move AgentLoop transcript and continuation state into Session.
- [x] Persist user, Tool round, and final assistant messages at coherent checkpoints.
- [x] Add compaction policy, deterministic compactor, provenance, and safe recent-tail view.
- [x] Bind continuation to the exact ContextView and clear it when compaction changes the view.
- [x] Verify create/load/resume, compaction, concurrency, and existing Stage 7 behavior.

## Plan

- [x] Implement Session contracts/store and focused regression tests.
- [x] Implement CompactionPolicy/Compactor and focused regression tests.
- [x] Integrate Session/Compaction with ContextAssembler and AgentLoop.
- [x] Update exports/topology and run full automated plus public API QA.

## Review

- Session and Compaction modules are implemented. AgentLoop supports explicit Session or
  `sessionId` resolution, persists complete assistant/tool exchanges, and uses an exclusive
  Session run lease. ContextAssembler derives summary-plus-tail views and drops mismatched
  continuation state. Full automated and direct public-API QA passed: 126 tests and 331 assertions.
- Post-write audit passed Biome, strict TypeScript, and the no-excuse TypeScript checker. LSP
  diagnostics timed out due the existing daemon/mise Node configuration; `tsc --noEmit` is clean.
- Final review added regression coverage for incomplete retained Tool rounds and invalid/stale
  compaction checkpoints. Stage 8 deliberately remains InMemory/same-process; durable storage,
  replay, and exactly-once external-effect recovery are deferred.
- `src/agent/agent-loop.ts` is in the programming skill warning band at 237 pure LOC but remains
  below the 250-line ceiling; split its session/compaction orchestration before adding more logic.

---

# Event, terminal, and failure contract foundations (Completed)

## Specification

- [x] Add branded AttemptId, positive AttemptNumber, and EffectDigest values.
- [x] Make ExecutionFailure and RunOutcome carry structured failure data while preserving display reasons.
- [x] Make HarnessEvent a correlated discriminated union with ordered timestamps.
- [x] Keep awaited EventSink delivery distinct from the latched terminal outcome.

## Plan

- [x] Inspect existing contracts, consumers, and focused regression coverage.
- [x] Add focused contract regression coverage.
- [x] Implement owned contracts, errors, EventWriter, and exports.
- [x] Run formatting, strict type checking, and focused tests.

## Review

- Focused contract tests pass for branded identities, typed failures, required correlation, monotonic
  sequences, and separate terminal delivery. Full gate passes with 107 tests and 282 assertions.


## Specification

- [x] Re-check the six proposed corrections against the current AgentLoop and ExecutionHarness.
- [x] Identify any semantic gaps or contract details that should change before further extension.
- [x] Separate Stage 7 invariants from intentionally deferred scheduling, replay, retry, and sandbox work.

## Plan

- [x] Inspect the active execution path with CodeGraph and current source.
- [x] Audit lifecycle, cancellation, governance ordering, and completion semantics.
- [x] Record a concise evidence-backed recommendation.

## Review

- The six corrections point in the right direction, and the proposed Stage 7 feature boundary is
  appropriately narrow. Generic hooks, retries, parallel scheduling, replay, coding profiles, and
  OS sandbox implementation should remain deferred.
- The scope facade must be a closed structured-concurrency scope, not only a callback API. A Turn
  must reject use after close, claim single model execution before awaiting, track child work, and
  settle or cancel every owned child before its terminal event.
- Attempt is not yet a real lifecycle because the public contract fixes it to literal `1`. Either
  defer the public Attempt contract or define a positive Attempt identity now and emit Attempt
  events only for actual effect invocations.
- Prepared execution must deep-freeze canonical input and capabilities, capture the executor, and
  bind approval to an effect digest. A pending approval can otherwise observe one effect and later
  execute a mutated one.
- The internal terminal decision and terminal event delivery need separate semantics. Event-sink
  failure after observing `run.completed` can currently lead to a subsequent `run.failed`; true
  external exactly-once delivery requires an idempotent or transactional sink.
- A hard Run deadline must cover callbacks and control-plane extension points as well as model and
  Tool effects. Cancellation must distinguish propagation from quiescence; non-cooperative work
  needs bounded settlement semantics, and workspace processes need TERM-to-KILL escalation if
  process exit is a hard invariant.
- Harness events should be a discriminated union whose correlation fields are required by event
  type. Active state should distinguish nonterminal Items, executing Attempts, and pending
  Approvals rather than relying on ambiguous counters.
- Tool exposure remains a model hint rather than authorization, but definitions and executable
  registrations should come from one immutable catalog. Tool failures should retain a typed
  internal form now even though retry classification remains deferred.
- Completion remains correctly limited to `accept | blocked`. A future `continue` must carry a
  concrete next AgentMessage and continuation advancement.
- Sandbox ordering should be expressed as executing the immutable prepared effect inside the
  sandbox boundary, not as a step after execution.

---

# Stage 7 Execution Harness v1 Invariant Implementation (Completed)

## Specification

- [x] Close Run/Turn scopes with child registration, cancellation, bounded join, and handle guards.
- [x] Derive active state from Item records and create Attempts only at effect invocation.
- [x] Make prepared effects runtime-immutable and bind approval to a canonical effect digest.
- [x] Separate terminal outcome latching from EventSink delivery and enforce event correlation.
- [x] Cover hard deadlines, AbortSignal propagation, process escalation, and typed failures.
- [x] Preserve sequential Tool batches, exposure snapshots, authorization, and accept/blocked completion.

## Plan

- [x] Lock each reproduced invariant with a failing-first regression test.
- [x] Implement lifecycle/state and prepared-effect foundations.
- [x] Implement terminal/event and cancellation semantics, then integrate AgentLoop.
- [x] Run focused tests, public API probes, and the complete check gate.

## Review

- `ExecutionScope` now closes `open -> closing -> closed`, registers children before start,
  rejects new work after close, and joins with a bounded cleanup result. ActiveRun/ActiveTurn
  retain child promises so fire-and-forget work cannot outlive terminal Turn/Run events.
- ItemRegistry derives nonterminal, executing-attempt, and approval-wait counts; attempts are
  created only at Model/Tool effect start. Prepared Tool effects are canonicalized, deep-frozen,
  executor-captured, and SHA-256 digested; approval responses must echo approval identity/digest.
- Event contracts require correlation by event kind. RunOutcome is latched synchronously before
  terminal delivery, and terminal EventSink failure is reported through `terminalDelivery` without
  rewriting a completed outcome. EventWriter serializes sequence assignment and bounds delivery.
- AbortSignal reaches Model auth/transport, Tool/Sandbox, approval, and workspace process groups;
  workspace cancellation escalates SIGTERM to SIGKILL after a grace period.
- Optional ToolCall transform and Sandbox execution seams are present without introducing a
  generic Hook engine or OS sandbox implementation. Full retry, parallel scheduling, replay,
  coding profiles, and durable outbox remain deferred.
- Automated gate: `bun run check` passed with 107 tests and 282 assertions. Manual public Agent
  API QA observed an approval-gated Tool inside Sandbox followed by `run.completed`; manual
  subprocess QA observed exit code 137 after TERM-resistant process-group cancellation.

---

# Stage 7 Execution Harness Implementation (Completed)

## Specification

- [x] Keep AgentLoop responsible for deciding the next model/Tool action and for transcript and
      continuation advancement; make ExecutionHarness control whether each action may start,
      continue, wait, or terminate.
- [x] Model Run -> Turn -> Model/Tool Item -> Attempt with branded identifiers and exactly one
      terminal RunOutcome.
- [x] Preserve `AgentLoop.run(): Promise<string>` on success and reject non-successful Runs with a
      typed execution error carrying the exactly-once terminal outcome.
- [x] Emit ordered correlated events with one run-scoped sequence and distinct Run, Turn, Item,
      Attempt, and provider Tool-call identities.
- [x] Enforce hard Run/Turn/Model/Tool/time budgets before starting effects and reject an oversized
      Tool batch without partially executing it.
- [x] Count every model-requested ToolCall before authorization; block an oversized batch before
      transcript mutation, preparation, execution, or continuation advancement.
- [x] Propagate one composed AbortSignal through ModelClient/ModelTransport and ToolRuntime/Tool to
      actual OpenAI requests and spawned workspace processes.
- [x] Snapshot exposed Tool definitions per Run, pass them through ContextAssembler on every Turn,
      and keep exposure separate from execution authorization.
- [x] Prepare and validate a ToolCall before capability extraction, then apply allow/deny/ask,
      bounded approval, and immutable execution in that order.
- [x] Make capability policy and approval broker explicit Harness dependencies, reject duplicate
      provider Tool-call IDs before effects, and bind approval to the complete prepared effect.
- [x] Execute Tool batches sequentially in model-call order and preserve correlated ToolResult order.
- [x] Accept or block model completion only after pending work has settled; do not add an
      input-less `continue` decision.
- [x] Keep generic hooks, progress heuristics, automatic retry, parallel scheduling, durable replay,
      coding-specific completion profiles, and OS sandbox implementation outside Stage 7.
- [x] Treat EventSink as an awaited control-plane dependency: sink failure fails the Run before
      further effects; standard events never contain Tool arguments, Tool output, credentials, or
      approval payloads.

## Plan

- [x] Add failing lifecycle, event, budget, cancellation, exposure, authorization, approval, and
      completion tests before production changes.
- [x] Implement cohesive Harness contracts and stateful execution façade without empty placeholder
      modules.
- [x] Extend Model and Tool execution contracts with AbortSignal and verified prepared calls.
- [x] Route AgentLoop through ExecutionHarness while preserving the existing four-request OpenAI
      continuation workflow.
- [x] Update public exports and architecture boundaries.
- [x] Run focused/full automated gates and real public-API cancellation and authorization workflows.

## Review

- `src/harness/` now owns scoped Run/Turn execution, branded correlation IDs, ordered redacted
  events, hard budget reservation, composed deadlines, terminal outcomes, Tool governance, bounded
  approval, and completion evaluation. Run finalization waits for child Turn cleanup, so terminal
  events remain last even during cancellation.
- AgentLoop still owns model-vs-Tool decisions, transcript mutation, and continuation advancement.
  It asks ContextAssembler to build every ModelInput from the Run's immutable exposed-Tool snapshot
  and mutates the transcript only after a Tool batch passes its atomic budget reservation.
- ToolRuntime now separates immutable preparation from execution. Preparation deep-clones model
  arguments, validates them, derives capabilities from that same typed value, and binds the executor
  to it, preventing approval/execution TOCTOU from later argument mutation.
- Workspace Tools describe canonical filesystem/process capabilities. All filesystem/process
  execution receives AbortSignal; the shared Bun process runner kills the actual subprocess on
  abort and awaits stdout, stderr, and exit cleanup.
- OpenAI requests receive the Harness signal through ModelClient and ModelTransport. SDK retries
  remain disabled and provider timeout errors remain distinct from Harness cancellation/deadlines.
- `bun run check` passed: Biome clean, strict TypeScript clean, and 73 tests with 183 assertions.
  The no-excuse TypeScript audit reported no violations in 72 files. Every changed production file
  remains at or below 250 pure LOC; the largest Harness production file is 250 pure LOC.
- Manual root-public-API authorization QA completed two model Turns and a three-Tool batch: read was
  allowed, write was denied without creating its target, shell requested approval and executed, and
  the same seven exposed Tools appeared on both Turns.
- Manual root-public-API cancellation QA aborted an active shell Run, proved its background child
  PID was gone before terminal completion, and ended with
  `tool.cancelled -> turn.cancelled -> run.cancelled`.
- Adversarial regression coverage also proves an always-failing EventSink still produces a typed
  failed outcome, CapabilityPolicy exceptions close their Tool Item, denial events do not leak
  policy-derived paths, and shell cancellation terminates the detached process group rather than
  only its parent shell.
- Exposed Tool definitions and nested schemas are deep-frozen for the Run. A non-cooperative Tool
  that ignores AbortSignal cannot defeat the hard bound: cleanup waits only for `cleanupTimeoutMs`
  and then terminates the Run with the typed `ToolCleanupTimeout` failure.
- An independent final code audit approved the implementation after the process-group, EventSink,
  policy-event, Tool-item finalization, cleanup-bound, and deep-freeze regressions were added.
- Generic hooks, adaptive progress/retry, parallel scheduling, persistent event replay,
  coding-specific completion profiles, and OS sandbox isolation remain intentionally deferred.

---

# Stage 7 Execution Harness Architecture Review (Completed)

## Specification

- [x] Compare the proposed Run / Turn / Item lifecycle with the current AgentLoop execution flow.
- [x] Verify ownership boundaries for events, budget, cancellation, retry, authorization, tools,
      progress, completion, hooks, and sandboxing.
- [x] Separate the contracts Stage 7 must stabilize from implementations that should remain deferred.

## Plan

- [x] Inspect the current AgentLoop, ContextAssembler, ModelClient, ToolRuntime, and public contracts.
- [x] Identify illegal states, responsibility leaks, and ordering/cancellation hazards in the proposal.
- [x] Record an evidence-backed Stage 7 recommendation and report it to the user.

## Review

- The Safety-to-Execution-Harness reframing is correct: AgentLoop remains the decision-maker while
  Harness owns the conditions under which model and Tool work may start, continue, wait, retry, or
  terminate.
- Run means one AgentLoop invocation; Turn means one logical model decision plus its Tool batch;
  Model and Tool are Items; retry executions are Attempts inside an Item. Approval, result, and
  failure are Item state transitions or events rather than separate logical Items.
- `waiting_approval` cannot share one flat status union with terminal outcomes because parallel work
  can be active while another Tool waits. Harness should maintain active counters and one atomic,
  exactly-once terminal `RunOutcome`.
- Public `startRun` / `startTurn` / `finishRun` methods permit invalid ordering and missed cleanup.
  Structured `withRun` / `withTurn` scopes or opaque handles with runtime transition guards must
  guarantee one start and one terminal event even on failure or cancellation.
- Every event needs a run-scoped sequence and correlated Run, Turn, Item, and Attempt identity.
  Durable journals and best-effort UI/telemetry observers need distinct failure semantics, and raw
  Tool inputs/outputs must not become an unredacted standard event payload.
- Cancellation and timeout are incomplete until one composed AbortSignal reaches ModelTransport,
  Tool execution, and spawned process termination. Promise racing without aborting the underlying
  HTTP request or process is not an acceptable timeout implementation.
- Tool exposure must be a per-run immutable snapshot passed into ContextAssembler; it is only a
  model capability hint, not authorization. Any returned ToolCall still requires execution policy.
- Tool governance order is fixed as transform, schema validation, canonical preparation,
  capability extraction, policy, bounded approval, then immutable execution. The approved effect
  must be bound to the prepared call so hooks cannot mutate it after authorization.
- The proposed CompletionGate `continue` result is incomplete because it supplies no changed model
  input and can repeat the same completion forever. Stage 7 should use `accept | blocked`; a later
  `continue` contract must carry an explicit next message and advance continuation state.
- Stage 7 should implement lifecycle scopes, correlated ordered events, hard budgets, real abort
  propagation, sequential Tool batches, per-run exposure, and one end-to-end validated prepared-call
  to allow/deny/ask to bounded-approval path through the existing public workflow. It should record
  future ownership but defer generic hooks, progress heuristics, automatic Tool retry, parallel
  scheduling, persistent replay, coding completion profiles, and OS sandbox code.

---

# Stage 6 Context Assembler Implementation (Completed)

## Specification

- [x] Add `ContextInput` with immutable messages and optional opaque continuation.
- [x] Add `ContextAssembler` that exclusively constructs `ModelInput` from messages, registered
      Tool definitions, and continuation without mutating its input.
- [x] Replace direct ModelInput construction in AgentLoop with ContextAssembler.
- [x] Preserve the existing four-round workspace Tool loop and OpenAI continuation cursor behavior.
- [x] Keep AGENTS.md resolution, compaction, token budgeting, sessions, memory, and RAG out of this
      minimal implementation.

## Plan

- [x] Add failing ContextAssembler unit tests and AgentLoop wiring assertions.
- [x] Implement and export the context module.
- [x] Inject ContextAssembler into AgentLoop and update composition/tests.
- [x] Update the Stage 6 architecture topology.
- [x] Run focused/full automated gates and a manual public-API workflow.

## Review

- `src/context/` now owns immutable ContextInput and ContextAssembler, and the root public API
  exports both through the context barrel.
- ContextAssembler is the only layer that constructs ModelInput from messages, Tool definitions,
  and optional continuation. It preserves the exact continuation object and omits the property
  rather than assigning undefined under exact optional-property semantics.
- AgentLoop now owns only call timing, transcript mutation, ToolRuntime execution, and continuation
  advancement; it no longer imports ModelInput or ToolDefinition or constructs `tools` directly.
- Context unit tests cover absent/present continuation with frozen inputs. The existing real
  OpenAI-adapter integration still completes `read_file -> grep -> git_diff` across four requests
  and now asserts every `previous_response_id` transition.
- Stage 6 topology permits Agent -> Context and Context -> Model/Core while preventing Context from
  depending on ToolRuntime or workspace adapters.
- `bun run check` passed: Biome clean, strict TypeScript clean, and 49 tests with 96 assertions.
  The no-excuse audit found no violations in 8 changed TypeScript files; every changed file remains
  below 200 pure LOC.
- Manual public-API QA performed a real `read_file` round trip through AgentLoop and verified two
  model requests, eight Tool definitions, observed file output, and preserved continuation state.
- AGENTS.md resolution remains intentionally deferred until a run-scoped stable instruction
  snapshot can be implemented without continuation cursor drift.

---

# Stage 6 Context Assembler Architecture Review (Completed)

## Specification

- [x] Compare the proposed ContextAssembler boundary with the current AgentLoop and ModelInput.
- [x] Verify user request, message history, tool definitions, and continuation ownership.
- [x] Assess the InstructionResolver seam and the correct Stage 6 completion criterion.

## Plan

- [x] Inspect the current AgentLoop, model input, provider continuation, and workspace composition.
- [x] Identify responsibility leaks or duplicate context in the proposed API.
- [x] Record an evidence-backed Stage 6 recommendation and report it to the user.

## Review

- The boundary is correct: AgentLoop should decide when to call model/tools, while ContextAssembler
  exclusively constructs the provider-neutral `ModelInput` shown to the model.
- Minimal `ContextInput` should contain `messages` and optional opaque `continuation`. The current
  AgentLoop already represents the user request once as a user message, so a separate unused
  `userRequest` would create two sources of truth and should be added only when a real consumer
  such as task routing requires it.
- ContextAssembler should receive only immutable Tool definitions. Registry lookup and ToolRuntime
  execution remain outside this layer, and continuation is passed through without interpretation.
- System instructions must form the same leading message prefix on every build within a run.
  OpenAI continuation cursors are derived from assembled message counts, so adding, removing, or
  accumulating a system message between rounds would skip or duplicate transcript items.
- InstructionResolver is the correct filesystem-facing seam for AGENTS.md, but it should be added
  with actual resolution behavior rather than as an unused placeholder. Resolution should happen
  once per run or otherwise guarantee a stable result for every model round in that run.
- Stage 6 completion requires AgentLoop to stop constructing `{ messages, tools, continuation }`
  directly; assembler unit tests must prove passthrough, non-mutation, stable system-prefix
  injection, and continuation identity, while the existing four-round workspace tool integration
  must remain green and assert post-cursor tool output is the only new provider input.
- Compaction, token budgeting, persistent sessions, memory, RAG, and generic context-provider
  frameworks remain correctly deferred.

---

# Stage 5 Workspace Tools Implementation (Completed)

## Specification

- [x] Add `read_file`, `list_directory`, `grep`, `git_status`, `git_diff`, `write_file`,
      `apply_patch`, and `shell` under `src/workspace/tools/`.
- [x] Resolve relative file, process, and Git operations from one injected workspace root without
      adding approvals, path blocking, command blocking, or timeouts.
- [x] Register all tools and expose their model definitions from one composition surface.
- [x] Add a production AgentLoop that feeds definitions to ModelClient, executes every returned
      ToolCall through ToolRuntime, and continues until the model completes.
- [x] Prove the example read/search/diff workflow through the real filesystem, Git, model adapter,
      ToolRuntime, and AgentLoop surfaces.

## Plan

- [x] Add failing tests for concrete tool behavior, composition, and the autonomous loop.
- [x] Implement the eight tools with deterministic, model-readable output contracts.
- [x] Implement workspace tool composition and AgentLoop integration.
- [x] Update public exports and the architecture topology test.
- [x] Run focused and full automated gates plus a real manual workflow.

## Review

- `createWorkspaceToolSet(workspaceRoot)` registers the eight typed tools in one place and returns
  the same definitions passed to `ModelClient`, without changing the generic Tool Registry API.
- File paths resolve from one normalized workspace root; grep, Git, patch, and shell subprocesses
  execute with that root as cwd. Safety policies remain intentionally absent from this layer.
- `AgentLoop.run()` now owns the provider-neutral model/tool cycle, preserves assistant/tool message
  order and continuation state, executes multiple calls sequentially, and returns completed text.
- Concrete integration tests cover all eight tools against real temporary files, Git repositories,
  ripgrep, shell processes, and unified patches. The OpenAI adapter integration runs the requested
  `read_file -> grep -> git_diff` sequence through four model requests.
- `bun run check` passed: Biome clean, strict TypeScript clean, and 47 tests with 87 assertions.
  The no-excuse audit found no violations in 18 changed TypeScript files; every changed file is
  below 200 pure LOC.
- Manual public-API QA registered all eight tools and returned final completion after observing real
  package contents, a line-numbered UserService match, and a real Git diff.
- Live OpenAI QA was unavailable because `OPENAI_API_KEY` and `JGENT_OPENAI_MODEL` are absent.
  File-level LSP requests also timed out despite the TypeScript server being installed; strict
  `tsc --noEmit` and Biome completed successfully as the authoritative diagnostics fallback.

---

# Stage 5 Workspace Tools Architecture Review (Completed)

## Specification

- [x] Compare the proposed eight Workspace Tools with the current Tool contracts and runtime.
- [x] Verify the intended registration and AgentLoop integration points.
- [x] Assess the implementation order, policy boundary, and observable completion criterion.

## Plan

- [x] Inspect the current Tool, ToolRuntime, ToolRegistry, model, and composition surfaces.
- [x] Identify architectural gaps and minimal corrections to the Stage 5 proposal.
- [x] Record the evidence-backed recommendation in this file and report it to the user.

## Review

- `src/workspace/tools/` is the right boundary for concrete filesystem, process, and Git adapters;
  `src/tool/` should remain the provider-neutral runtime and registry layer.
- The proposed eight tools and read-first implementation order are appropriate, but the current
  `InMemoryToolRegistry` registers tools one at a time and does not expose definitions for
  `ModelInput.tools`; the composition API must supply registration and definitions from one place.
- A deterministic base working directory is functional execution context, not Safety policy. It
  should be injected now, while path-boundary enforcement, approvals, command blocking, and
  timeouts remain deferred.
- `shell`, `grep`, and `apply_patch` need explicit I/O contracts before implementation, especially
  cwd, stderr/exit behavior, line-numbered grep output, and unified-diff semantics.
- The repository still has no production `AgentLoop` or application bootstrap. Stage 5 can prove
  real tools through `ToolRuntime`; autonomous `read_file -> grep -> git_diff` selection is an
  AgentLoop-level acceptance test unless that loop is explicitly included in this stage.
- The stage-three topology test already describes an older source layout and fails independently;
  its fixed source-file allowlist will also need deliberate replacement or extension when Stage 5
  production files are added.

---

# Tool Module Grouping (Active)

## Specification

- [x] Move Tool Registry, Runtime, and Validator from `src/core/` to `src/tool/`.
- [x] Add `src/tool/index.ts` and preserve the root public API without making Core own Tool runtime exports.
- [x] Update direct consumers to import Tool runtime values through the Tool/root public surface.
- [x] Inspect `core/contracts/model.ts` vs `model/model-input.ts` and `openai-response.ts` vs
      `openai-types.ts` for overlap, without restructuring them in this change.

## Plan

- [x] Inspect current files, imports, exports, architecture checks, and model/OpenAI responsibilities.
- [x] Relocate the three Tool implementation files and update their import paths.
- [x] Add the Tool barrel and update public/test imports.
- [x] Run formatting, strict type checking, focused tests, the full test suite, and a real Tool round trip.

## Review

- `src/tool/` now owns `tool-registry.ts`, `tool-runtime.ts`, `tool-validator.ts`, and its public
  `index.ts`; `src/core/index.ts` exports only provider-neutral Core contracts.
- The root `src/index.ts` preserves the public Tool API by exporting `src/tool/index.ts`, and Tool
  tests consume that public surface.
- `core/contracts/model.ts` contains `ModelContinuation` and `ModelOutput`; `model/model-input.ts`
  alone contains `ModelInput`, so their responsibilities do not overlap.
- `openai-response.ts` parses and normalizes external response payloads, while `openai-types.ts`
  aliases OpenAI SDK request/model types; they are complementary rather than duplicate.
- Biome checked all 38 files, strict `tsc --noEmit` passed, the no-excuse audit passed, and the two
  Tool suites passed 8 tests.
- A manual root-public-API round trip returned
  `{ "toolCallId": "manual_call", "success": true, "output": "moved-tool-runtime-ok" }`.
- Full suite result: 34 passed and 1 pre-existing Stage-3 topology test failed because it still
  expects the broader future auth/model file consolidation that this scoped change intentionally
  did not perform.
- Every touched TypeScript file is below 200 pure LOC; production files are at most 47 pure LOC.

---

# Stage 1-3 Module Boundaries (Paused)

## Specification

- [ ] Keep `src/core/contracts/` as the only shared Core surface.
- [ ] Place Model Client, API-key auth, and OpenAI Responses implementation under `src/model/`.
- [ ] Place Tool Registry, Validator, and Runtime under `src/tool/`.
- [ ] Ensure `src/model/` and `src/tool/` never import each other; both may import only Core contracts.
- [ ] Keep production `AgentLoop` absent through stage 3.
- [ ] Match the requested source topology, consolidating omitted supporting contracts into the named files.

## Plan

- [x] Capture a recoverable baseline and add a failing topology-boundary test.
- [ ] Fold `ModelInput` into Core contracts and relocate Tool Runtime.
- [ ] Consolidate model auth and OpenAI Responses files into the requested topology.
- [ ] Remove obsolete barrels, support files, and smoke-only surfaces outside the stage-3 tree.
- [ ] Verify topology, dependency boundaries, formatting, types, and all tests.

## Review

- Recoverable baseline: `/tmp/jgent-stage3-refactor.ATdHF4`.
- The new topology test fails against the pre-refactor tree as intended.
- Baseline `bun test` and `bun run typecheck` also expose a pre-existing orphan smoke test that
  imports the already-absent `src/smoke/openai-smoke.ts`; the target stage-3 topology removes that
  stale test and its script.

---

# Tool Runtime Alignment

## Specification

- [x] Resolve a `ToolCall` through a dedicated Tool registry.
- [x] Validate model-provided arguments before concrete Tool execution.
- [x] Keep concrete Tool inputs typed and free of `toolCallId`.
- [x] Convert Tool success, expected failure, validation failure, unknown Tool, and thrown exceptions
      into correlated `ToolResult` values.
- [x] Keep retry, permission, sandbox, timeout, approval, and repetition policy out of this layer.

## Plan

- [x] Compare the latest Tool Runtime contract with the current implementation.
- [x] Add failing tests for the missing contract behavior.
- [x] Separate registry, validation, and runtime orchestration without weakening input types.
- [x] Run focused formatting, type checking, tests, and a real `read_file` round trip.

## Review

- `InMemoryToolRegistry` stores heterogeneous typed Tools through a prepared execution closure, so
  concrete Tools receive only schema-validated input without using `Tool<unknown>` or a type cast.
- `AjvToolValidator` validates without coercion, defaults, or property removal; invalid arguments do
  not invoke the Tool.
- `ToolRuntime` now owns lookup, validation orchestration, execution, exception normalization, and
  `toolCallId` correlation while remaining free of Harness/Safety policy.
- Focused Biome and strict TypeScript checks passed; the TypeScript no-excuse audit reported no
  violations in the six changed TypeScript files.
- Full test suite: 34 passed. Direct SDK smoke executed `read_file` against `./package.json` and
  returned `{ toolCallId: "call_1", success: true, output: "..." }` with the real file contents.
- Full project `bun run typecheck` is currently blocked by a concurrent, unrelated
  `tests/model/openai-tool-loop.integration.test.ts:90` exact-optional-property error; the changed
  Tool Runtime files pass the same strict compiler flags in isolation.
- All changed source files are below 50 pure LOC; the largest changed test file is 162 pure LOC.

---

# Core Contracts and Tool Runtime

## Specification

- [x] Define immutable `AgentMessage`, `ToolCall`, `ToolResult`, `ToolDefinition`,
      `ModelOutput`, `ToolExecutionResult`, and executable `Tool` contracts.
- [x] Preserve assistant tool calls and tool results losslessly in `AgentMessage`.
- [x] Keep `toolCallId`, tool lookup, argument validation, and result correlation inside
      `ToolRuntime`; concrete tools receive only validated input.
- [x] Use JSON Schema for provider-facing tool definitions and AJV for runtime validation.
- [x] Represent success/failure and model completion/tool-call states as discriminated unions.
- [x] Return model-recoverable failures for unknown tools, invalid arguments, expected tool
      failures, and unexpected implementation exceptions.
- [x] Support multiple tool calls in `ModelOutput` without implying parallel execution.

## Plan

- [x] Scaffold the strict Bun/TypeScript project.
- [x] Add failing ToolRuntime tests.
- [x] Implement contracts, registry, and runtime.
- [x] Run Biome, TypeScript, tests, and a real round-trip smoke.

## Review

- `bun run check`: Biome clean, TypeScript clean, 7 tests passed.
- No-excuse TypeScript audit: no violations in 8 source/test files.
- Manual SDK smoke: `read_file` read `package.json`, preserved `manual_call`, and returned the
  expected project name.
- Source files remain below the 250 pure-LOC ceiling; the largest test file is 128 lines and the
  largest production file is 64 lines.
- `ToolRuntime` owns lookup, validation, correlation, and duplicate registration detection.
  Concrete tools receive schema-validated typed input; this review note predates the active
  dependency-separation alignment above.

---

# API-Key Model Client

## Specification

- [x] Keep `AgentLoop` provider-neutral through `ModelClient.generate(ModelInput)`.
- [x] Make model-facing `ToolDefinition` non-generic while preserving schema-linked typed Tool
      execution.
- [x] Bind the OpenAI model when composing the client rather than exposing provider model names in
      `ModelInput`.
- [x] Let `AgentLoop` carry an opaque `ModelContinuation` with a consumed-message cursor so
      reasoning-model tool loops can use Responses state without hidden ModelClient session state.
- [x] Support only OpenAI Platform API-key authentication in this phase; do not add ChatGPT OAuth or
      generic bearer-token handling.
- [x] Keep API-key acquisition, provider mapping, HTTP/SDK transport, and ModelClient composition in
      separate owners.
- [x] Map the full v1 transcript into Responses API items: system/user/assistant text, assistant
      function calls, and correlated function-call outputs.
- [x] Parse external Responses API data at the adapter boundary and reject malformed, failed,
      cancelled, queued, in-progress, or incomplete responses with typed model errors.
- [x] Preserve multiple function calls and optional assistant text in `ModelOutput`.
- [x] Never expose an API key in errors, logs, fixtures, or task evidence.

## Plan

- [x] Add focused failing contract, adapter, transport, and composition tests.
- [x] Implement model/auth contracts and typed errors.
- [x] Implement the OpenAI Responses adapter and API-key transport.
- [x] Prove the composed client against a local HTTP server.
- [x] Add `bun run smoke:openai` as a secret-safe live verification entrypoint.
- [ ] Prove the same path against the live OpenAI API after `OPENAI_API_KEY` and a model are supplied.

## Review

- Focused Biome check passed across the 28 changed source, contract, and test files.
- `bun run typecheck` passed with strict and exact-optional-property checks.
- TypeScript no-excuse audit reported no violations in the 28-file scope.
- Seven focused test files passed: 34 tests and 62 assertions covering auth, request/response
  mapping, continuation, abnormal statuses, malformed arguments, API-key redaction, Tool Runtime
  consumers, and a two-request reasoning tool loop.
- A manual SDK driver imported only the public `src/index.ts` surface and returned
  `{ stopReason: "completed", content: "MANUAL_OUTPUT", ... }` through the real OpenAI SDK against
  an ephemeral local HTTP server.
- `bun run smoke:openai` now uses the same public composition, prints only stop reason, content
  length, and continuation provider, and fails closed before transport when its model or API key is
  absent. Its three focused tests pass against an ephemeral local endpoint.
- The OpenAI SDK transport disables SDK retries so the future Harness remains the retry-policy
  owner, and it emits fixed typed error messages that cannot echo the API key.
- Live OpenAI verification was not run because neither `OPENAI_API_KEY` nor
  `JGENT_OPENAI_MODEL` is present in the process environment.
- Responses continuation currently uses stored `previous_response_id` state. A future ZDR mode
  must carry encrypted reasoning items instead of relying on stored response state.
