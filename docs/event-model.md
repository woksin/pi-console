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
| `RequestObserved` | A human-origin prompt (id, session, text pointer, origin) |
| `AnswerObserved` | Assistant final message for a request, or an interim answer (flag) |
| `RequestInterrupted` | Run ended at a reset or abort before a final answer |
| `RequestMarkedUnanswered` | Derived by projection, not emitted by adapters |
| `RequestSeen` | Console-only display state ("seen"); never changes the source |

**Questions**

`QuestionAsked`, `QuestionRevised`, `QuestionAnswered`, `QuestionDeferred`, `QuestionClosed` (from the question store, including kind, options, urgency, blocking flag, asker).

**Messages and lanes**

`MessageSent`, `MessageDelivered`, `MessageRead` (from lane messages, pi-orch inbox and receipts), `BroadcastSent`; `LaneRegistered`, `LaneStatusChanged` (including `waiting-on`, `barred-by`, `parked`), `LaneClosed`; `IssueClaimed`, `IssueStatusChanged`.

**Work**

`JobStarted`, `JobFinished`; `PhaseQueued`, `PhaseStarted`, `PhaseFinished`; `SubagentStarted`, `SubagentFinished`; `ReviewRecorded` (head SHA, verdict).

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

Projections run in a single projector inside the daemon, after the append transaction. A projection has a stored position (`seq`). A schema or reducer change bumps its version and triggers a rebuild from the log. Observable queries fan out from the projector ([ADR-0002](adr/0002-web-stack-node-arc-typescript-react.md)).

### Request and answer derivation

See [ADR-0008](adr/0008-relationship-to-intent-memory.md). States: `open`, `answered`, `unanswered`, `interrupted`, `answer possibly unseen`. Derived states carry the evidence (message ids, reset id) so the UI can show why.

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
