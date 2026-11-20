# M1 acceptance record (P6)

Status: **not accepted**: warm first-screen readiness, idle memory and full view/coverage evidence miss the criteria below. Final measurements (P6b) were taken once on 2026-11-20, code `1cbb472`, Node v26.8.1, macOS arm64, with all sources enabled and the default 14-day backfill. The earlier 68-file pairing audit is retained separately, not presented as a new audit of the final copy.

| Acceptance bullet | Result | Evidence |
|---|---|---|
| Replay from empty reproduces every read model byte for byte | PASS | `packages/core/src/projector/projector.test.ts`: "replay from empty equals incremental live projection, byte for byte" and "restarting from stored snapshots and continuing equals a replay from empty" |
| Kill at any point and restart loses nothing and duplicates nothing | PASS | `packages/core/src/event-log/kill-restart.integration.ts` (random kill points), `packages/daemon/src/daemon.test.ts` (stream ids continue across restart). Run by `gate:integration` |
| Every real human prompt appears with an answer or an explicit state | **MISS (full coverage not established)** | Earlier session audit: 134 raw user messages, 134 derived requests. Final copy: 1,996 requests and 316 questions returned; question-store ingestion is proven, but exhaustive prompt coverage and question-to-session linkage were not audited on this larger population |
| Hand-checked sample of 30 shows no wrong pairing beyond what the UI labels uncertain | PASS | table below |
| No known secret shape in the database or any API response | PASS | `packages/daemon/src/secrets.test.ts` (API bodies, SSE snapshot and deltas, real session ingestion: event, checkpoint and projection rows), `packages/testkit/src/secret-shapes.test.ts`. Fixture shapes only; the real copy was not scanned for secrets |
| Cold start to first screen under 3 s with a 14-day backfill in the background | **PASS cold; MISS warm** | First-data readiness: web **2.820 s**, TUI **2.470 s** cold; web **4.983 s**, TUI **4.259 s** warm. Actual HTTP/SSE client data paths, not browser paint or terminal render; method below |
| Idle daemon memory under 150 MiB | **MISS** | see breakdown below |
| No valid token, wrong Host or foreign Origin refused | PASS | `security.test.ts` (token hash, exact token, CSRF/Origin), `http/boundary.test.ts` (foreign-Origin SSE refused with valid credentials, on the real server), `http/static-files.test.ts` (wrong Host and foreign Origin: 403). Missing-token 401 at HTTP level is only specified on the mock daemon (`testkit/src/mock-daemon/daemon.test.ts`); the real daemon has it at unit level |
| Source adapters for context-budget, lanes and messages, question store, jobs and phases feed the views | **PASS ingestion; MISS full view coverage** | Real query totals: 316 questions, 199 messages, 46,279 jobs (40,360 phases); `/graph`: 96 nodes / 4 edges. Context-budget: 2,316 handoff resets, all linked to projected sessions. Both Fleet views consume sessions whose lane is the documented `unassigned` placeholder; live context-pressure samples are absent. These are documented M1 limitations, not newly discovered contract violations |

## Final real-data method and results (P6b)

Only the daemon's allow-listed inputs were copied with `cp -p`, preserving mtimes; originals were never modified. The copy contained 725 session files (869.6 MiB), 1,566 question files, 199 inbox files, 34 lane registry/roster files, 65 lane-status files, 27 heartbeat files, 3 context event logs, the issue registry and 16 phase-ledger day files. Sessions were selected newest-first from files modified within 10 hours, capped at 0.85 GiB; this is a bounded real-data population, **not** an exhaustive 14-day session archive. The daemon's backfill window stayed at 14 days, including the other sources' in-record window filtering. Total source bytes: 1,228.5 MiB. Peak source plus daemon data: 1.418 GiB, below the 2 GiB cap; `du -sh` before running was 1.2G, and after both runs was 1.2G sources / 225M daemon data. Free disk stayed above 28 GiB (35 GiB before, 33 GiB during, 35 GiB after cleanup).

The diagnostic forked a real daemon on an ephemeral port with a fresh data directory, then started both clients concurrently as soon as the API was ready. Timing starts before the daemon fork (including module loading), not at the first successful HTTP request. Web used the production `ConsoleStore` / `createApi`; TUI used the production `DaemonClient`, `Store` and the initial needs-you refresh logic from `runtime.connect`, without launching the terminal renderer. Readiness required a populated stream store and completion/JSON parsing of initial derived queries: `/needs-you` and `/health` for web, `/needs-you` for TUI. No transcript selection, history paging, browser paint or terminal rendering was included. An open SSE response was timed through its first applied snapshot, not just its headers. Clients disconnected after readiness; health sampling continued externally through ingestion and projection/delta drain. Warm restart reused the same database and unchanged input copy. This was one cold/warm pair, not a repeated benchmark; the host was shared and the phase runner applied nice 10.

| Timing | Cold | Warm |
|---|---|---|
| API ready from daemon fork | 0.392 s | 2.898 s |
| Web first populated snapshot applied | 2.464 s | 4.229 s |
| Web initial queries complete with data | 2.820 s | 4.983 s |
| TUI first populated snapshot applied | 2.466 s | 4.257 s |
| TUI initial queries complete with data | 2.470 s | 4.259 s |
| Sessions held at first data readiness (each client) | 218 | 134 |
| Backfill-complete flag observed | 29.846 s | 12.592 s |
| All source lag / projection queue drained | 176.669 s | 12.592 s |
| External `/health` p50 / p99 / max (through backfill and drain) | 2.633 / 540.693 / 2,382.232 ms (1,271 samples) | 10.900 / 1,330.836 / 1,330.836 ms (42 samples) |

Health was sampled sequentially with 100 ms between completed requests, including body parsing; the reported latency window includes the post-ingestion projection/delta drain, not only the interval before `backfill.complete`. Snapshot warnings reported oversized candidate frames and the documented active-only fallback. Final projection position equalled event-log position, 189,784; all seven source health rows had zero lag and zero errors, and the projector reported zero skipped events. There were 918 body-free `SourceSchemaUnknown` events (658 session, 73 question, 186 phase, 1 lane); nonzero warning counts are not a claim that every raw input shape is supported.

Final HTTP totals: `/sessions` 1,190; `/requests` 1,996; `/questions` 316; `/messages` 199; `/jobs` 46,279. Sessions include rows materialized by non-session sources, so this is not the session-file count. Job kinds in the persisted projection were 5,919 jobs and 40,360 phases. Lane events included 75 registrations, 4 status changes and 88 closures; 92 lane rows yielded 96 graph nodes including message endpoints. Lanes are served by **`/graph`, not `/lanes`**, as specified in [API v1](api/v1.md). Both web and TUI Fleet use `fleetViewModel` over session rows, not `/graph`; a real session page produced a Fleet group and session row with lane `unassigned`. The API contract documents this missing session-to-lane link. Context-budget contributed 2,316 `ResetOccurred` handoff events, all referencing a projected session; its status/turn files intentionally feed no facts, and the burn projection had no pressure samples. Source ingestion therefore passes, while claiming full Fleet lane/live-pressure view coverage would be incorrect.

**Issue retention policy:** after a fresh database, issues whose registry activity is older than 14 days drop out, even if still logically open. Current-state question/lane snapshots are not filtered this way. This is the configured backfill policy, not proof that all old issues were closed.

Both daemon workers exited 0. The invocation's outer command timeout expired after queueing plus execution; the diagnostic continued, completed both runs, and wrote a successful result. It was not rerun for a better number. After confirming both data directories were unheld with `pi-holders`, exactly the copied-source and daemon-data directories were deleted. Harness and numeric results remain untracked under `.ai-work/p6b/`; no source bodies or credentials are published here.

## Earlier real-week coverage audit

The earlier P6 audit used 68 files, 57 MB, dated 2026-10-31 to 2026-11-20, with a widened 365-day window because that copy was older than 14 days. Its totals were 68 sessions, 134 requests, 278 jobs and no question/message source data. Raw `user` message entries were 134, equal to derived requests. This supports that session subset, not exhaustive coverage of the final copy.

## Earlier pairing sample (30)

Drawn with `packages/core/tools/sample-requests.ts` (seed 7) over the copy; each row was checked against the raw JSONL (the entries after the prompt, up to the next human turn). Sample ids are the first 8 hex of sha256(session id + entry id); the prompts are not reproduced.

| # | sample id | derived state | label | raw check | verdict |
|---|---|---|---|---|---|
| 1 | 51ec7b1e | answered | none | next human turn or first final reply in raw JSONL matches | correct |
| 2 | a8d6928c | answered | shared-answer | next human turn or first final reply in raw JSONL matches | correct |
| 3 | 7d98e573 | answered | none | next human turn or first final reply in raw JSONL matches | correct |
| 4 | c55906dc | answered | none | next human turn or first final reply in raw JSONL matches | correct |
| 5 | 6844839a | open | none | open by rule: only error turns follow | correct |
| 6 | 6f0dd781 | open | none | open by rule: stop turn without text is no answer | correct |
| 7 | c14835be | answered | none | next human turn or first final reply in raw JSONL matches | correct |
| 8 | 54bdb718 | answered | none | interim answers kept, last one is final | correct |
| 9 | 19d26735 | answered | none | next human turn or first final reply in raw JSONL matches | correct |
| 10 | 26f63c76 | answered | none | next human turn or first final reply in raw JSONL matches | correct |
| 11 | 401b809a | answered | none | next human turn or first final reply in raw JSONL matches | correct |
| 12 | f4ebce65 | answered | none | next human turn or first final reply in raw JSONL matches | correct |
| 13 | d274bd73 | open | none | open by rule: stop turn without text is no answer | correct |
| 14 | b1eaa1d6 | open | none | open: nothing follows the prompt | correct |
| 15 | dd849453 | answered | none | next human turn or first final reply in raw JSONL matches | correct |
| 16 | 62228711 | answered | none | interim answers kept, last one is final | correct |
| 17 | 59ccf21a | answered | none | next human turn or first final reply in raw JSONL matches | correct |
| 18 | ffdf9f57 | answered | none | next human turn or first final reply in raw JSONL matches | correct |
| 19 | b2eaf809 | answered | none | next human turn or first final reply in raw JSONL matches | correct |
| 20 | 47e25598 | answered | none | next human turn or first final reply in raw JSONL matches | correct |
| 21 | e7d94f5a | answered | shared-answer | 3 prompts, one answer: labelled shared-answer | correct |
| 22 | 16c14df5 | answered | none | next human turn or first final reply in raw JSONL matches | correct |
| 23 | d75ccd2d | answered | none | correct by rule; final answer is a later wake-up turn, the first reply is kept as interim (not labelled) | correct |
| 24 | 44c59e72 | answered | none | next human turn or first final reply in raw JSONL matches | correct |
| 25 | 2ea3137b | answered | none | next human turn or first final reply in raw JSONL matches | correct |
| 26 | f4b73019 | answered | shared-answer | prompt, prompt, reset, answer: labelled shared-answer | correct |
| 27 | 540232b3 | answered | none | interim answers kept, last one is final | correct |
| 28 | 62763773 | answered | none | next human turn or first final reply in raw JSONL matches | correct |
| 29 | 2709d8dd | answered | none | next human turn or first final reply in raw JSONL matches | correct |
| 30 | e9ac4173 | answered | none | next human turn or first final reply in raw JSONL matches | correct |

Summary: 30 of 30 correct. Open states by rule (rows 5, 6, 13, 14): no final assistant text follows the prompt. Shared-answer labels (rows 2, 21, 26) are the labelled uncertainty. One judgement to note: row 23 keeps the first reply as an interim answer and the later wake-up reply is not paired to it; that is the documented rule, not a mispairing. Rows 8, 16 and 27 keep interim answers with the last as final.

## Idle memory: MISS, with breakdown

Final all-source daemon, sampled via `process.memoryUsage()` after drain plus **60 s idle**, with no clients, no forced GC and no tuning:

| Measure | MiB |
|---|---|
| Idle RSS | **360.89** (target <150: **MISS**, 210.89 over) |
| V8 heap used / total | 109.13 / 175.91 |
| external | 11.59 |
| arrayBuffers (included in external, not additive) | 3.90 |
| RSS immediately after drain | 382.61 |
| Sampled and kernel peak RSS during cold run | 583.70 |
| Sampled peak heap used | 241.35 |
| Separate bare Node process with `node:sqlite` imported (no DB open), RSS | 47.81 |
| Persisted projection row JSON bytes | 30.45 |
| Retained SSE frame text bytes (10,000 frames, 0 clients) | 5.30 |
| SQLite files (database + WAL + shared memory), on disk | 223.29 |

Attribution is an arithmetic guide, **not resident-page accounting**: RSS minus heap used is 251.77 MiB. Of that difference, 66.78 MiB is the gap between V8 heap total and used, and 11.59 MiB is reported external allocation. RSS minus heap total minus external leaves **173.40 MiB unattributed**: runtime/code/stacks, SQLite native allocations/page caches, allocator retention/fragmentation and differing resident/committed accounting may contribute. The 47.81 MiB separate runtime baseline overlaps this residual; it is not an additional allocation. It would be unjustified to label the whole residual SQLite memory.

The retained projections are principally request/session derivation state (18.41 MiB serialized JSON combined), jobs (10.05 MiB) and session rows (1.67 MiB). These JSON sizes are proxies for the live JS structures, not measured heap ownership. SSE text likewise contributes to retained JS state; its byte count is not extra RSS to add to the heap figure. A diagnostic inspector session counted private ring frame text after the first memory sample, then released its references and disconnected; the idle sample may include diagnostic allocation residue. No heap snapshot was taken.

SQLite memory could not be measured directly: Node's `DatabaseSync` exposes neither `sqlite3_memory_used` nor `sqlite3_db_status`. A separate read-only diagnostic connection reported 4,096-byte pages, 55,309 pages and default `cache_size=-2000` (about 2,000 KiB configured cache target for that connection, **not** measured daemon cache residency or total SQLite memory). Database file size is not resident memory. Native SQLite versus allocator/code attribution therefore remains unmeasurable with this driver; the RSS target itself is conclusively missed.

## Other P6 items

- Transcript edge cases (null request ids, standalone final, final after a reset, interleaved requests): table spec in `packages/viewmodels/src/session/session.test.ts`.
- Coloured TUI tour: [media/tui/tour-colour.cast](media/tui/tour-colour.cast), regenerated by `npm run media -w @pi-console/tui` (byte-identical on two runs).
- Final verification: `npm run gate` passed every Tier 1 stage. `npm run gate:integration` failed at `packages/daemon/src/ingestion/source-volume.integration.ts:51`: worst `/health` was 284.930 ms against `<200 ms`. Core random-kill, daemon startup/first-screen and TUI integration specs passed. Assertions after the failed health check in the volume spec were not reached. No production fix or timing retry was attempted; this record is not an acceptance pass.
