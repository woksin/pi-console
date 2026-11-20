# M0: SQLite EventLog driver

## Question and recommendation

Can `node:sqlite` (Node 26 built-in) or `better-sqlite3` provide the ADR-0001 event-log semantics and adequate append/replay throughput at 1M events? **Both pass the tested contracts. Choose `node:sqlite` for M1**, pinning and verifying the Node runtime. It avoids the native addon/prebuild dependency and measured faster append throughput. Better-sqlite3 measured faster replay and lower RSS; revisit if runtime support or actual projector measurements favor it. Both APIs block the Node event loop.

## Built

`spikes/sqlite-eventlog` is a separate npm package with one `EventLog` port, shared schema/SQL/transaction/subscription implementation and two connection factories. `append(events)` returns the new seq range/count, or null for empty/all-duplicate batches. `readFrom(seq, limit)` uses an **exclusive** checkpoint (0 starts replay), ascending bounded reads. `subscribe(fromSeq, handler)` catches up then delivers committed appends on this instance; unsubscribe and reentrant appends are tested. Failed observers detach without making a committed append fail. There is no cross-process/durable subscription promise.

Schema: `seq INTEGER PRIMARY KEY`, unique idempotency key, event type/version and JSON payload; initial `schema_version` table. WAL, synchronous FULL, 5s busy timeout. Appends use BEGIN IMMEDIATE/COMMIT with complete rollback on error. Duplicate keys are no-ops, including duplicates inside a batch; the first payload wins. No deletion API means committed seqs remain increasing. Schema upgrade validation/runners and projector checkpoints are not implemented.

Use `npm ci`, `npm run build`, `npm test`, `npm run bench` inside the spike. Node 26 native type stripping runs the TypeScript tests/benchmark directly. The README details inputs, port semantics and limitations. Native-script approval for better-sqlite3 13.2.0 was required and is recorded in package.json; `node:sqlite` needs no addon. This package's `npm audit` passed with zero vulnerabilities.

## Results

Single run on **Node 26.8.1**, Darwin 25.6.0 arm64, Apple M4 Pro, 48 GiB RAM, local APFS. One fresh process/database per driver; 1,000,000 events, **300-byte JSON payloads**, batches of 1,000; replay chunks of 1,000 include JSON parsing. Peak RSS comes from process resource usage, not heap size. File size is measured after closing/checkpointing the final connection. No projector work is included.

| Driver | Append events/s | Replay events/s | File bytes | Peak RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| `node:sqlite` | 314,597 | 364,226 | 365,211,648 | 205.6 |
| `better-sqlite3` 13.2.0 | 230,234 | 635,305 | 365,211,648 | 173.2 |

Append/replay elapsed: **3.179 / 2.746 s** built-in; **4.343 / 1.574 s** addon. The run completed at 1M events, but **no throughput cliff or scale knee was measured**: these are rough single-run local numbers, not distributions or multi-writer capacity. Both process 1M events in seconds. The immediate concern for interactive SSE traffic is synchronous blocking; use bounded batches and consider worker offload, not merely an async function signature. Other platforms/Node releases and actual projectors need measurement.

Eight tests passed, four per driver: replay/order/idempotency/reopen/WAL; catch-up/live/unsubscribe/reentrant delivery/observer failure; rollback with no notification; and **SIGKILL mid-batch**. The child commits one row, inserts 1,000 rows in a second transaction, then signals/blocks in serialization before COMMIT. After SIGKILL, reopen sees only the prior committed event, next append gets seq 2, and integrity_check returns `ok`. This tests process-crash atomicity, **not power failure, storage corruption or crash-during-COMMIT durability**.

```sh
~/.pi/agent/bin/pi-phase run --kind test --policy direct --label m0-sqlite-contract-fixed --timeout 300 -- sh -c 'npm --prefix spikes/sqlite-eventlog run build && npm --prefix spikes/sqlite-eventlog test'
~/.pi/agent/bin/pi-phase run --kind test --policy direct --label m0-sqlite-million --timeout 300 -- npm --prefix spikes/sqlite-eventlog run bench
```

Both commands exited **0**. The one benchmark run used a **300s timeout and the label above**, rather than the brief's suggested 600s / `m0-sqlite-bench`; it finished in about 12s and was not repeated. Databases remain only in ignored repository-local `.ai-work/` directories. The aggregate Tier 1/Tier 2 gate described in the Arc note also passed; no Docker or .NET was used.

## Code Health

All files are new, so there is no prior score. Reviews and final scores were obtained through CodeScene. Generated proxies were not refactored.

| Hand-written file | Before | After |
| --- | --- | ---: |
| `spikes/sqlite-eventlog/event-log.ts` | new | 9.84 |
| `spikes/sqlite-eventlog/benchmark.ts` | new | 10 |
| `spikes/sqlite-eventlog/test/contract.test.ts` | new | 10 |
| `spikes/sqlite-eventlog/test/crash-worker.ts` | new | 10 |
| `spikes/arc-ts/server/main.ts` | new | 10 |
| `spikes/arc-ts/server/Features/Rows.ts` | new | 10 |
| `spikes/arc-ts/client/main.tsx` | new | 10 |
| `spikes/arc-ts/vite.config.ts` | new | unscored |
| `spikes/arc-ts/generate.mjs` | new | 10 |
| `spikes/arc-ts/test/live.test.mjs` | new | 10 |

CodeScene cannot determine a score for the small declarative Vite config. The pre-commit safeguard checked 14 eligible files and **failed** on the new `SqliteEventLog.deliver` function's two nested conditional blocks (`Bumpy Road Ahead`), even though its file scores **9.84**, above the 9.5 threshold. This finding is reported, not hidden; no post-gate Code Health-only refactoring loop was performed. No scored file is below 9.5.
