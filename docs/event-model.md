# Event model

The console is event-sourced ([ADR-0001](adr/0001-event-sourced-console-sqlite-event-log.md)). One append-only log is the source of truth; read models are projections that can be rebuilt by replay.

## 1. Event envelope

| Field | Meaning |
|---|---|
| `seq` | Monotonic integer assigned on append (log order) |
| `id` | UUID v7 |
| `type` | Event type name, past tense, for example `RequestObserved` |
| `version` | Schema version of this event type |
| `occurredAt` | When it happened at the source (source timestamp) |
| `recordedAt` | When the console appended it |
| `source` | Adapter or origin: `session-jsonl`, `context-budget`, `lane-messages`, `question-store`, `extension`, `console`, `direct`, ... |
| `idempotencyKey` | Unique; derived from (source, file identity, offset or entry id, type). Duplicate appends are no-ops |
| `subject` | Stream key: `session:<id>`, `lane:<id>`, `question:<id>`, `message:<id>`, `job:<id>` |
| `actor` | `system`, `user:<tokenId>` or `agent:<sessionId>` |
| `payload` | Type-specific, small; large text lives in the source file and is referenced by pointer |
| `refs` | Pointer to source: file, byte offset, entry id |

Rules: payloads never contain unredacted secrets; if redaction cannot run, the text is withheld and a `withheld` marker is stored (contract invariant 4). Events are immutable. Corrections are new events.

### M1 observed-source gaps (P2)

**turn lifecycle: not observable from S1; arrives with the M2 extension channel (ADR-0005)**. There are no turn lifecycle records or turn IDs in S1 v3; M1 never infers them. Job/subagent lifecycle is emitted only from explicit structured records: S1 pi-jobs starts/completion batches qualify; notification prose and S10 raw command output do not. No verified explicit subagent lifecycle records were found in the inspected S1 writer.

Other absent signals remain gaps, not guessed facts: S2 token counts/policy thresholds lack a context-window denominator (no pressure percentage or downsampling); its backstop/relaunch intent does not prove a reset. S4 `lanes.json` lacks registration times (file mtime is used), `until` deadlines in lane-status are not carried, and messages encode HHMM without a date. S5 acknowledgements do not mean delivered/read and lack a corresponding raw contract event. S8 low/urgent priority cannot be coerced to normal/high; unsupported values warn. S9 session links/PR numbers lack claim lane identity/review SHA. S11 final ledger rows supply retrospective timestamps, not live transitions. S13 inspected review output is opaque prose, with no verified structured head-SHA/verdict record. See [adapter details](../packages/adapters/README.md) for exact mappings and source selection.

## 2. Event catalogue

Groups, with the source each event comes from ([research summary](research-summary.md), S1 to S17).

**Sessions and context**

| Event | Source | Notes |
|---|---|---|
| `SessionStarted`, `SessionEnded` | session JSONL, pi-orch | cwd, model, role (main or subagent), parent session |
| `ModelChanged`, `ThinkingLevelChanged` | session JSONL | |
| `TurnStarted`, `TurnEnded` | session JSONL, extension | stop reason, usage |
| `ContextPressureSampled` | context-budget status | percent, thresholds; downsampled |
| `ResetOccurred` | session JSONL compaction entries, context-budget events, handoff files | kind: handoff, compaction, relaunch; lists requests open at that moment when known |
| `SessionHeartbeat` | pi-orch, watchdog | used for staleness |
| `TokenStreamed` (live only) | extension | coalesced deltas; not persisted long-term |

**Requests and answers**

| Event | Notes |
|---|---|
| `RequestObserved` | A prompt that needs an answer: id, session, text pointer, `origin` (`human`, `launch` for a non-relaunch initial prompt, or `unproven`), `originEvidence`. Origin is set only from positive evidence ([ADR-0008](adr/0008-relationship-to-intent-memory.md)); `launch` and `unproven` are labelled in the UI and never shown as the user's words |
| `AnswerObserved` | Assistant final message for a request, or an interim answer (flag) |
| `RequestInterrupted` | Run ended at a reset or abort before a final answer |
| `RequestMarkedUnanswered` | Derived by projection, not emitted by adapters |
| `RequestSeen` | Console-only display state ("seen"); never changes the source |
| `RequestClosed` | From the intent-memory store: `request_close` (answered or abandoned, answer id, closer) |
| `MemoryItemRecorded`, `MemoryItemConfirmed`, `MemoryItemRetired`, `MemoryMessageRecorded`, `MemoryMessageClassified` | From the intent-memory store (S3), read-only: items (directive, order, decision) with a redacted excerpt, their confirm and retire lifecycle, and journal message metadata (origin, size, withheld) without text. Replaces the planned `Directive*` names: items are not only directives |
| `BoundaryRecorded` | From the intent-memory store: boundary kind, open-request idSet (with `unresolved(count)` when a blob is missing), last answer id |

**Questions**

`QuestionAsked`, `QuestionRevised`, `QuestionAnswered`, `QuestionDeferred`, `QuestionClosed` (from the question store, including kind, options, urgency, blocking flag, asker). `QuestionSnapshotObserved` carries a question's whole state at one source revision (status, times, links) and `QuestionHistoryRecorded` one stored history entry (sequence, operation, time, actor label, bounded note); `QuestionLinkStateObserved` (source `github-closures`, opt-in) records the observed GitHub state of one link target for one link-set revision, including `unknown` for a failed refresh, which supersedes an earlier success; it never changes the question's status. All three are keyed by the source's logical identity, so reading a revision file again, or a later revision that repeats the history, adds nothing new. The highest revision wins whatever the order of arrival.

**Messages and lanes**

`MessageSent`, `MessageDelivered`, `MessageRead` (from lane messages, pi-orch inbox and receipts), `BroadcastSent`; `LaneRegistered`, `LaneStatusChanged` (including `waiting-on`, `barred-by`, `parked`), `LaneClosed`; `IssueClaimed`, `IssueStatusChanged`.

**Work**

`JobStarted`, `JobFinished`; `PhaseQueued`, `PhaseStarted`, `PhaseFinished`; `SubagentStarted`, `SubagentFinished`; `WorkflowStepCompleted` (workflow journal step, S7); `ScheduledSubagentDefined`; `ReviewRecorded` (head SHA, verdict).

**Operations, recovery and setup** (secondary sources, deferred; see section 2.1)

`RecoveryReportCreated` (S12); `TaskScopeCreated`, `TaskScopeLeased`, `TaskScopeFinished`, `UnfinishedTaskReported` (S14); `GuardDecided`, `DockerGcRan`, `DiskPressureSampled`, `HostMemorySampled`, `DelegationNudged` (S15); `ProviderLimitHit`, `ProviderFallbackActivated`, `ProviderFallbackRestored`, `ModelPinned`, `ConfigSnapshotTaken` (S16); `TrainStateChanged`, `RelaunchScheduled`, `FusionRunObserved` (S17).

**Interventions** (produced by the console)

| Event | Notes |
|---|---|
| `InterventionRequested` | Command type (answer, steer, follow-up, next-turn, pause, abort), target, text, issuer, token id, origin, time to live |
| `InterventionDelivered` | Extension receipt, timestamp |
| `InterventionRejected` | Reason: handoff in progress, expired, not permitted, target gone |
| `InterventionFailed` | Delivery error |

**System**

`SourceCheckpointAdvanced`, `SourceUnavailable`, `SourceSchemaUnknown`, `BackfillProgressed`, `TokenCreated`, `TokenRevoked`, `RemoteAccessEnabled`.

## 3. Projections

Pure reducers `(state, event) -> state`, with no I/O and no clock access, so replay is deterministic.

| Read model | Built from | Used by |
|---|---|---|
| `Sessions` | session, turn, heartbeat, context events | Fleet, session header |
| `Lanes` | lane events, claims | Fleet, graph |
| `Needs you` | questions, requests, lane status | Overview, badges |
| `Requests` | request, answer, reset events | Requests view |
| `Questions` | question events | Questions queue |
| `Messages` and graph edges | message events | Messages, graph |
| `TimelineSpans` | turn, reset, request, answer, question, intervention events | Swimlane timeline |
| `Work` | job, phase, claim, review events | Work view |
| `Audit` | intervention and system events | Activity view |
| `Burn` | turn usage events | Sparklines and cost panels |

### 2.1 Source to adapter to event mapping

Every source in the data-source inventory (S1 to S17, [research summary](research-summary.md)) has a row. "MVP" means built in M1 ([milestones](milestones.md)); "Deferred" means designed but not built until the milestone named. Credentials, browser profiles and cookies (part of S17) are never read.

| Source | What | Adapter strategy | Events | Status |
|---|---|---|---|---|
| S1 | Session JSONL | Tail by offset and inode; directory watch; backfill window | `SessionStarted`, `ModelChanged`, `TurnStarted`, `TurnEnded`, `RequestObserved`, `AnswerObserved`, `ResetOccurred`, `JobStarted`/`JobFinished` (from job messages), `SubagentStarted`/`SubagentFinished` (from notifications) | MVP |
| S2 | context-budget status, events, turns, handoff files | Tail with rotation handling; watch status and handoff globs | `ContextPressureSampled`, `ResetOccurred` | MVP |
| S3 | Intent-memory store | Read-only subset (MVP): `events.jsonl` from byte 0 and `journal/*.jsonl` metadata. `boundary`, `request_close`, `answers/` and `blobs/` stay with the request derivation (Phase B, deferred) and are never opened | `MemoryItemRecorded`, `MemoryItemConfirmed`, `MemoryItemRetired`, `MemoryMessageRecorded`, `MemoryMessageClassified` (later: `RequestObserved`, `AnswerObserved`, `RequestClosed`, `BoundaryRecorded`) | Records carry a CRC-32; a bad checksum or an unknown schema/type is a body-free `SourceSchemaUnknown` |
| S4 | Lanes registry, lane messages, lane-status, inbox markers | Directory watch; poll atomic-rename files; parse filename grammar | `LaneRegistered`, `LaneStatusChanged`, `LaneClosed`, `MessageSent`, `MessageRead`, `BroadcastSent` | MVP |
| S5 | pi-orch heartbeats, sessions, inbox, receipts | Poll 2 to 5 s; watch inbox and receipts | `SessionHeartbeat`, `MessageDelivered`, `MessageRead` | MVP |
| S6 | Session watchdog board | Poll 30 to 60 s | `SessionHeartbeat` (cross-check for stuck or waiting) | Deferred to M2 |
| S7 | Subagent outputs and workflow journals (volatile) | Tail live; copy-on-index into `blobs/` as files grow | `SubagentStarted`, `SubagentFinished`, `WorkflowStepCompleted`, `ScheduledSubagentDefined` | MVP for outputs; workflow journals Deferred to M2 |
| S8 | Question store | Watch new revision and receipt files; writes only through the store's CLI | `QuestionAsked`, `QuestionRevised`, `QuestionAnswered`, `QuestionDeferred`, `QuestionClosed`, `MessageDelivered` (receipts) | MVP (read); writes in M2 |
| S9 | Issue-work register | Tail registry; poll cache | `IssueClaimed`, `IssueStatusChanged` | MVP |
| S10 | Job logs | Bounded tail; lifecycle from S1 messages | `JobStarted`, `JobFinished` | MVP |
| S11 | Phase queue ledger and live state | Tail today's ledger; poll waiters with a non-blocking shared lock probe | `PhaseQueued`, `PhaseStarted`, `PhaseFinished`, `HostMemorySampled` | MVP |
| S12 | Recovery reports | Directory watch | `RecoveryReportCreated` | Deferred to M5 |
| S13 | Review logs | Glob and tail append | `ReviewRecorded` | MVP |
| S14 | Task lifecycle (read-only CLI report) | Poll 5 to 10 min | `TaskScopeCreated`, `TaskScopeLeased`, `TaskScopeFinished`, `UnfinishedTaskReported` | Deferred to M5 (schema unread) |
| S15 | Ops logs: guard decisions, docker-guardian, cleanup, disk, memory | Tail | `GuardDecided`, `DockerGcRan`, `DiskPressureSampled`, `HostMemorySampled`, `DelegationNudged` | Deferred to M5 |
| S16 | Provider limits, fallback, pins, configuration changes | Watch config; limit hits from S1 entries; poll usage CLI | `ProviderLimitHit`, `ProviderFallbackActivated`, `ProviderFallbackRestored`, `ModelPinned`, `ConfigSnapshotTaken` | Deferred to M5 |
| S17 | Trains, fusion state, relaunch markers (secondary) | Low-rate poll | `TrainStateChanged`, `RelaunchScheduled`, `FusionRunObserved` | Deferred to M5 |

Sources whose schema was not sampled (S12, S14, S17) get a fixture-based adapter spec before any implementation, and the adapter stops on an unknown schema version ([ADR-0004](adr/0004-ingestion-tailers-over-existing-files.md)).

Projections run in a single projector inside the daemon, after the append transaction. A projection has a stored position (`seq`). A schema or reducer change bumps its version and triggers a rebuild from the log. Observable queries fan out from the projector ([ADR-0002](adr/0002-web-stack-node-arc-typescript-react.md)).

### Request and answer derivation

See [ADR-0008](adr/0008-relationship-to-intent-memory.md). States: `open`, `answered`, `unanswered`, `interrupted`, `answer possibly unseen`. Requests, answers and boundary records follow intent-memory contract v1.2 §10; until `memory.requests` ships, Phase A derivation from session JSONL applies and only positively proven origins raise attention (`unproven` prompts never do). Derived states carry the evidence (message ids, reset id) so the UI can show why.

## 4. Idempotency and ordering

- Appends use `INSERT ... ON CONFLICT(idempotencyKey) DO NOTHING`. A re-read of the same bytes appends nothing new.
- Events from different sources have no global causal order beyond `seq`. Projections order by `occurredAt` only where a view needs it, and tolerate late arrivals (backfill).
- A source adapter appends its events and advances its checkpoint in one transaction, so a crash cannot create a gap or a duplicate.
- Single writer: only the daemon appends.

## 5. Schema evolution

- Each event type has a version; payloads are additive within a version.
- A breaking change adds a new version; an **upcaster** converts old versions when reading, so stored events are never rewritten.
- Unknown event types and versions are skipped by projections and counted in a metric, never fatal.
- Source schema changes (for example the answers record `memory.answer/1` versus `/2`) are handled in the adapter, which reads the schema field and stops with `SourceSchemaUnknown` for an unrecognised version instead of guessing.
- Projection changes rebuild from the log; the log stays the source of truth.

## 6. Privacy and retention

- Redact at ingestion; fail closed. Credential files, browser profiles and environment files are on an adapter deny list.
- Events hold pointers and short excerpts; full tool results are read from source files on demand and redacted at the point of return.
- Retention is configurable per event group. Default: keep request, answer, question, intervention and reset events indefinitely; downsample context pressure samples after 14 days; drop `TokenStreamed` after the session ends.
- The data directory is owner-only (0700); the database and token files are 0600.

## 7. MVP slices

Small vertical slices, each with its adapter, events, projection and view, in this order:

1. **Event log core**: envelope, SQLite append, idempotency, replay, checkpoints (no views).
2. **Sessions**: session JSONL adapter, `Sessions` projection, Fleet table.
3. **Context pressure**: context-budget adapter, pressure bars and sparklines.
4. **Requests and answers**: derivation, interrupted state, Requests view.
5. **Questions**: question store adapter, Questions queue, `Needs you` Overview.
6. **Lanes and messages**: registry and message adapters, Fleet grouping, Messages list.
7. **Jobs, phases, claims**: Work view.
8. **Session detail**: transcript from source by offset, reset markers, right rail.
9. **Security baseline**: tokens, Host and Origin checks, redaction specs (starts in slice 1 and is a gate for all others).

Later slices (M2 and after): extension live channel, interventions, graph, timeline, Direct adapter, intent-memory store adapter.
