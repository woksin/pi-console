# M0 — SQLite event-log port spike

**Recommendation: `node:sqlite` for M1, with a pinned, verified Node runtime.** Both drivers satisfy the tested port semantics. The built-in driver removes the native addon/prebuild installation dependency and measured faster append throughput here. `better-sqlite3` has faster replay and lower peak RSS in this run; retain this comparison if M1 targets an older Node release or replay dominates. This is a small synchronous implementation, **not** an event-loop-safe production persistence layer.

## Reproduce

Tested on **Node v26.8.1, macOS Darwin 25.6.0 arm64, Apple M4 Pro, 48 GiB RAM**, local APFS storage. Other Node releases/platforms have not been verified. The tests execute TypeScript with Node's native type stripping. Both implementations are selected through the same class/port and run the same contract tests.

```sh
cd spikes/sqlite-eventlog
npm ci
npm run build    # strict TS typecheck
npm test         # all contracts, including SIGKILL recovery for both drivers
npm run bench    # fresh process and database per driver; 1M events each
```

Pinned `better-sqlite3@13.2.0` is explicitly approved for npm lifecycle scripts. A native compiler/toolchain is required if no compatible prebuild exists. There is no addon dependency when choosing `node:sqlite` in a future production package; this comparison package installs both on purpose. `npm audit` for this package reported zero vulnerabilities.

Test databases and benchmark output databases are retained under repository-root `.ai-work/m0-sqlite-tests/` and `.ai-work/m0-sqlite-bench/`, not committed. A benchmark run creates roughly 700 MiB total; check disk before repeating. No automatic deletion is performed.

## Port and semantics

`event-log.ts` exports `EventLog`, `EventInput`, `StoredEvent`, `SeqRange`, and `SqliteEventLog`.

- `append(events): SeqRange | null` wraps the entire batch in **BEGIN IMMEDIATE / COMMIT** (ROLLBACK on failure). The range covers **newly inserted** rows only; all-duplicate and empty batches return null. The result includes first/last seq and count. Serialization failure rolls back earlier inserts in the same batch and emits no notification.
- `seq INTEGER PRIMARY KEY` yields increasing committed sequence numbers without requiring AUTOINCREMENT. There is no delete API; rolled-back numbers may be reused because they never became committed events.
- A **unique idempotencyKey** plus conflict-ignore makes retries no-ops, including duplicates within one batch. First stored event wins even if a retry's payload differs. Type, version and JSON payload are stored together; inputs must be JSON-serializable.
- `readFrom(seq, limit)` means **exclusive checkpoint**, i.e. `WHERE seq > ? ORDER BY seq LIMIT ?`. Start with 0 and advance to the last returned seq. The positive limit bounds materialization; no whole-log load is required.
- `subscribe(fromSeq, handler)` synchronously catches up from that same exclusive checkpoint, then delivers committed appends through this instance. Registration precedes catch-up; a pumping guard handles appends from inside the handler without gaps/duplicates. It returns unsubscribe. Delivery is per event, in seq order, after commit; failed handlers are detached so a committed append does not appear to fail. This is not a durable subscription/cross-process bus. Reopen/reconnect with your saved checkpoint to recover.
- SQLite uses **WAL, synchronous=FULL, busy_timeout=5000**. `schema_version` records initial schema version 1. This is initialization only: no upgrade runner/unknown-version guard is implemented yet. The table is groundwork for explicit M1 migrations, not proof of migration support.

The adapter-neutral `Connection` type is deliberately small and the application consumes `EventLog`, not a driver's transaction/statement API. The two concrete drivers differ only at connection creation; all schema, SQL, transaction and subscription logic is shared.

## Contract / crash evidence

Eight tests passed (four contracts per driver): ordered bounded replay, same-/mixed-batch duplicates and restart; replay-then-live/unsubscribe/reentrant append/failed observer isolation; complete rollback with zero notifications; and **SIGKILL during an open append transaction**. The child first commits one row, inserts 1,000 rows in a second batch, then blocks during payload serialization before COMMIT and signals readiness over IPC. The parent kills it, reopens the file, observes **only the prior committed row**, appends the next seq, and checks `PRAGMA integrity_check = ok`.

This is process-crash atomicity evidence, **not power-loss or disk-corruption testing**. It does not measure multiple writers, lock contention, backup/restore, compaction or a crash during COMMIT. SQLite's guarantees still depend on storage/fsync behavior.

## 1M-event result

One run per driver, sequentially, in separate fresh Node processes. Exactly 1,000,000 events, **300-byte UTF-8 JSON payload** each, short unique keys, 1,000 events per transaction, replay chunks of 1,000. Append includes JSON serialization, index maintenance and commit cost. Replay includes row materialization and JSON parsing; no projector work. Identical schema/settings for both. File sizes are measured after closing the final connection/checkpointing the WAL. Peak RSS is `process.resourceUsage().maxRSS` converted from KiB to MiB, not JS heap.

| Driver | Append events/s | Append seconds | Replay events/s | Replay seconds | Peak RSS MiB | Database bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `node:sqlite` | 314,597 | 3.179 | 364,226 | 2.746 | 205.6 | 365,211,648 |
| `better-sqlite3` 13.2.0 | 230,234 | 4.343 | 635,305 | 1.574 | 173.2 | 365,211,648 |

The run completed at 1M events; **no throughput cliff or knee/scale threshold was measured**. This is rough local evidence, not a benchmark distribution, concurrency claim or disk-capacity forecast. At approximately 348 MiB database size, both append/replay times are seconds rather than minutes; the immediate M1 bottleneck risk is **synchronous event-loop blocking**, not inability to store 1M rows. Retaining/copying all parsed payloads in an application would invalidate the bounded replay memory profile.

## M1 boundary

Keep batch sizes bounded and expose the persistence boundary so a worker/async facade can be substituted if latency under active SSE traffic requires it. An async signature alone does not offload synchronous work. Projector checkpoint persistence, event type/version upcasting, projection rebuild orchestration, tenant partitioning, durable observer error reporting, explicit migrations and multi-process invalidations remain M1 work. Benchmark those with the real projector and active clients before using these numbers as a capacity commitment. The Arc spike's Drizzle/better-sqlite3 read model does not force the event-log driver choice; these are separate ports/connections and must not accidentally share a transaction API.
