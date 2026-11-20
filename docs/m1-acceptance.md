# M1 acceptance record (P6)

Status: **partial**. Everything provable without the source adapters is recorded here. Items that need the lane, message, question, context-budget and phase sources wired into the daemon are PENDING (P1b, branch `l192/m1-p1b-sources`). Measurements were taken on 2026-11-20 with Node v26.8.1 on macOS (arm64) against a read-only copy of a real week of session files: 68 files, 57 MB, 2026-10-31 to 2026-11-20 (backfill window widened to 365 days because the copy is older than 14 days; the copy is not committed).

| Acceptance bullet | Result | Evidence |
|---|---|---|
| Replay from empty reproduces every read model byte for byte | PASS | `packages/core/src/projector/projector.test.ts`: "replay from empty equals incremental live projection, byte for byte" and "restarting from stored snapshots and continuing equals a replay from empty" |
| Kill at any point and restart loses nothing and duplicates nothing | PASS | `packages/core/src/event-log/kill-restart.integration.ts` (random kill points), `packages/daemon/src/daemon.test.ts` (stream ids continue across restart). Run by `gate:integration` |
| Every real human prompt appears with an answer or an explicit state | PASS for session-derived requests; PENDING (P1b) for question-store linkage | 134 raw user messages in the copy, 134 requests derived (see below) |
| Hand-checked sample of 30 shows no wrong pairing beyond what the UI labels uncertain | PASS | table below |
| No known secret shape in the database or any API response | PASS | `packages/daemon/src/secrets.test.ts` (API bodies, SSE snapshot and deltas, real session ingestion: event, checkpoint and projection rows), `packages/testkit/src/secret-shapes.test.ts`. Fixture shapes only; the real copy was not scanned for secrets |
| Cold start to first screen under 3 s with a 14-day backfill in the background | PENDING (first-screen render not yet timed in either client) | Partial evidence: API ready in 8 ms; backfill of the whole copy finished in under 10 s; `GET /api/v1/health` reports `backfill.complete` |
| Idle daemon memory ≤ 250 MiB RSS (≤ 220 MiB physical footprint) | PENDING real-data rerun against revised M1 target | P7 target accounts for shared Node text, malloc fragmentation and read models retained in RAM; disk-backed models are deferred. Historical measurements below are unchanged. |
| No valid token, wrong Host or foreign Origin refused | PASS | `security.test.ts` (token hash, exact token, CSRF/Origin), `http/boundary.test.ts` (foreign-Origin SSE refused with valid credentials, on the real server), `http/static-files.test.ts` (wrong Host and foreign Origin: 403). Missing-token 401 at HTTP level is only specified on the mock daemon (`testkit/src/mock-daemon/daemon.test.ts`); the real daemon has it at unit level |
| Source adapters for context-budget, lanes and messages, question store, jobs and phases feed the views | PENDING (P1b) | The daemon wires only session ingestion today. On the real copy `/questions` and `/messages` return 0 items and `/lanes` returns 404, so Questions, Messages, Fleet lane data and the context budget are empty end to end (lane registration, status and closure from the real lane-status, `lanes.json` and roster formats are wired in P1c). Jobs (278) come from session records |

## Real-week counts

`/sessions` 68, `/requests` 134, `/jobs` 278, `/questions` 0 (PENDING P1b), `/messages` 0 (PENDING P1b). Raw `user` message entries in the 68 files: 134, equal to the derived request count, so no human prompt is dropped.

## Pairing sample (30)

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

## Idle memory: historical breakdown

The revised M1 target is ≤ 250 MiB RSS idle (≤ 220 MiB physical footprint). P7 synthetic measurements identified shared Node text, malloc fragmentation and live read models in RAM as material contributors; disk-backed read models are deferred to a later milestone. This changes the target, not the historical measurements or their scope. A real-data acceptance rerun against the revised target is still pending.

Measured on the same copy after backfill, 30 s idle, not tuned:

| Measure | MiB |
|---|---|
| Daemon RSS (ps, health) | 157-159 |
| After forced GC (`--expose-gc`), RSS | 136 |
| V8 heap total / used (after GC) | 52 / 15 (new space reserved 32, old space 9, large objects 4) |
| external / arrayBuffers | 8 / 0 |
| Bare Node 26 process RSS | 48 |
| Bare Node 26 with `node:sqlite` open | 51 |
| SQLite files after backfill (db + WAL) | 2 + 4 |

Reading: about 51 MiB is the runtime floor with SQLite loaded. The remaining ~85 to 105 MiB is mostly reserved V8 heap (52 MiB total, only 15 used) plus uncollected garbage from backfill (21 MiB between GC and no GC) and native memory not attributed to the JS heap (RSS minus heap total minus external is about 76 MiB, including code, ICU and the SQLite page cache). No heap snapshot was taken. Candidate levers, not applied: smaller `--max-semi-space-size`, a GC after backfill, a SQLite `cache_size` cap.

## Other P6 items

- Transcript edge cases (null request ids, standalone final, final after a reset, interleaved requests): table spec in `packages/viewmodels/src/session/session.test.ts`.
- Coloured TUI tour: [media/tui/tour-colour.cast](media/tui/tour-colour.cast), regenerated by `npm run media -w @pi-console/tui` (byte-identical on two runs).
