# Read-only ingestion adapters (P2)

`FileTailer` reads JSONL through read-only, no-follow descriptors. Pass a shared
`EventLog`, a source id, and a schema-guarded mapper returning catalogue facts.
The mapper must reject unsupported source versions and use stable domain ids;
it must never infer human origin. Malformed records and failed mappings become
body-free `SourceSchemaUnknown` events. Payloads and metadata are redacted before
validation and append; transcript bodies are never copied. Source refs retain
`{file, offset, entryId}`. Empty lines are skipped and torn lines re-read.

Polls are serialized and bounded to one batch per descriptor (default 1 MiB),
providing back-pressure to the caller. Await the poll before closing. Events and
complete-line checkpoints go through one `EventLog.append` transaction. The
caller owns discovery scheduling; `discover` defaults to a 14-day mtime window,
skips credential/browser/environment paths and never follows directory symlinks.
Keep the tailer alive to drain late writes to renamed files; on restart include
archives in discovery. Close releases all retained descriptors.

## Carried limitation

Size drops advance generation. **Truncate-and-regrow between polls is not
reliably detectable**: a rewrite reaching the previous size can silently hide an
epoch. A changed hash of the previously observed first (at most) 512 bytes emits
a `SourceSchemaUnknown` warning, but does not reset offsets or recover skipped
bytes. Changes beyond that prefix may be missed entirely. Normal prefix growth
on append is not a warning. The specs pin this documented missed-epoch case.

## S1 observations

`sessionTailer(log, path, options)` reads a bounded v3 header to recover the
session id even after a checkpoint restart. Use one instance per logical session,
not one instance for a directory of unrelated sessions. Include renamed archives
of that session in polls. Unsupported headers and entries produce body-free
`SourceSchemaUnknown` events. The synthetic v3 fixture mirrors inspected real
record keys; no real transcript content is included.

S1 maps session start, model/thinking changes, compaction, user prompts, final
assistant messages (`stop`), explicit assistant aborts (`aborted`), pi-jobs tool
starts, and structured pi-jobs completion batches. Batch members have distinct
idempotency discriminators. **turn lifecycle: not observable from S1; arrives with the M2 extension channel (ADR-0005)**.
No turns or turn IDs are inferred. No verified explicit subagent lifecycle
records were found; notification prose is not parsed. User-role prompts remain
`unproven`: neither first position nor role proves launch provenance. Answers and
aborts carry `raw: true`, sessionId and entryId, without a fabricated requestId.
P5 alone derives pairing and request state. Tool results are not answers.
The installed v3 `SessionHeader.parentSession` is a parent **file path**, not a
session id (the writer's fork operations set it from the source filename).
Absent `parentSession` in v3 means `parentSessionKnown: true` with a null id.
Present paths are retained as `parentSessionPath`, but the id remains unknown
(`parentSessionKnown: false`); resolving another file's header is not implemented.
Neither path filenames nor prompt text are parsed for ids. Header `role: main`
is a contract-required compatibility default, **not observed classification**:
v3 has no role field, and a fork path does not prove subagent/orchestrator status.
Only `stop` produces an answer; `length`, `pending`, `deferred`, `toolUse` and
`error` are explicitly ignored. Unknown future stop reasons still warn.
Structured job snapshots use finite epoch-ms `startedAt`/`endedAt`, converted to
ISO timestamps; invalid/out-of-range values warn rather than dropping jobs silently.

## Other sources and documented gaps

All mappers consume `unknown`, emit only explicit facts, and turn unsupported
shapes/enums into body-free warnings. Synthetic writer-shaped examples are in
`src/fixtures/sources.json`; real transcripts are never fixtures.

| Source | Mapping and gaps |
| --- | --- |
| S2 context-budget | `handoff_committed` → reset. Status/turn rows contain token counts and policy thresholds, **not window capacity or percent**: pressure percentage/downsampling cannot be supplied. Backstop/relaunch intent does not prove a reset. No turns inferred. |
| S4 lanes | Registry/roster validated as snapshots. Registry lacks occurrence timestamps; roster lacks the contract-required human-readable lane name. No registration/status/closure inferred from presence/absence. Message filenames have HHMM but no date: no fabricated message timestamp or prose parsing. |
| S5 orch | Explicit messages → `MessageSent` (`lane-messages`); heartbeat → `SessionHeartbeat` (`lane-heartbeats`). Receipts `acked`/`declined`/`done` do not mean delivered/read; the contract has no acknowledgement event. |
| S8 questions | Unversioned local (`kind/body/urgency`, history `at`) and installed v1 (`type/text/priority`, history `ts`) immutable revisions emit only their last history operation, never old history with new text. Created/edited/answered/decided/deferred/closed/withdrawn map to question observations; withdrawn closes with reason `withdrawn`. No defer-until is recorded (`null`). Priority `low`/`urgent` cannot be represented losslessly by normal/high and warns instead of coercing. Claim/reopen/decline/comment have no matching raw event. |
| S9 issue-work | Explicit `state` → `IssueStatusChanged`, preserving state and repo-qualified issue key. No claim without lane identity; no PR/review-head fact without SHA. Session links alone have no matching event. |
| S10 job logs | Opaque command output is skipped; no free-text job/subagent lifecycle parsing. Explicit job lifecycle comes only from S1 structured records. |
| S11 phase ledger | Explicit queuedAt/startedAt/endedAt → retrospective phase observations when the final row arrives. Identity is the source tuple `argvHash:queuedAt`. No start/finish when startedAt is null; this is not live queue telemetry. Known transport gap: emitted `phase:*` subjects are not accepted by the envelope's subject kinds, so these facts cannot yet be appended to the durable log. Hostile-id coverage stops at the mapper for this source. |
| S13 review logs | Opaque workflow/command prose is skipped. No verified structured head-SHA/verdict record in the inspected local writer; no `ReviewRecorded` inferred. A structured producer needs a versioned mapper. |

## Transport and daemon seams

`pollSnapshot` reads bounded JSON through one read-only descriptor, hashes content,
and commits observations/checkpoint atomically. It handles atomic rename and
same-size rewrites; roots are explicit and credential/symlink boundaries apply.
`FileTailer` remains the JSONL transport. Source selection is caller-owned:
messages and heartbeats use separate source identities; do not feed arbitrary
registries or metadata into a mapper.

`AdapterSupervisor` starts/stops/restarts a polling worker, drains in-flight work
on stop, and recreates failed workers with capped exponential backoff. Supply
the same durable EventLog on recreation; checkpoints are authoritative. The
process-kill spec exercises SIGKILL and resumed ingestion.

`readTranscript({ path, roots, offset, limitBytes, scanner })` is the daemon seam.
Resolve paths from the daemon's index, not browser input. It returns complete
redacted JSON records and the next byte offset, buffering at most 1 MiB per page.
A complete record exceeding `limitBytes` is scanned to its newline with bounded
memory, withheld as `{ withheld: true, oversize: true }`, and advances the cursor
past that newline. Scanning may read beyond the page budget; no fragment is exposed.
`partial` signals an incomplete/over-budget trailing line. Torn tails, including
oversized ones, retain their cursor until the terminating newline arrives.
It never writes pi data or emits turns.

## Read-only real-week probe

Run `node packages/adapters/scripts/probe.mjs` from the repository root. It reads
only allowlisted local pi trees, last seven days by file mtime, without following
symlinks or reading credentials. It writes aggregate counts/unknown-record rates
only to `.ai-work/p2/probe.txt`. S10/S13 logs are counted but not opened. Real data
and this report must never be committed. Missing sources count as zero.
