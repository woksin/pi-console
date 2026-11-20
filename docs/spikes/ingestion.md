# M0 ingestion spike

**Result:** transport-level proof of ADR-0004 on Node 26.8.1 (`node:sqlite`, no dependencies).
`spikes/ingestion/` is isolated: no workspace or other spike imports were changed.
This is not yet a session/context-budget domain-event adapter or the complete event envelope.

## Proven

- Read-only descriptors; identity is device + inode + birth time, independent of rotation name.
  SQLite checkpoints retain path, generation, complete-line byte offset, observed size and mtime.
- Newline framing keeps incomplete UTF-8 bytes at the source (re-read on next poll/restart),
  never in SQLite. Retained descriptors drain late writes to renamed files; rediscovered
  archives recover unread bytes after restart. Observed size drops increment a durable generation.
- SHA-256 of `(source, identity, generation, byte offset, event type)` gives the key;
  the unique index makes duplicate inserts no-ops. Generation distinguishes copy-truncate epochs.
  Events and checkpoint updates share one `BEGIN IMMEDIATE` / `COMMIT`, WAL, synchronous FULL.
- Ten `node:test` specs cover partial UTF-8/restart, rename/reopen while writing, archive recovery,
  size drop with a pending partial, rollback/retry, actual process exit inside the transaction,
  two identical-byte replays, redaction failure, malformed input and disallowed paths.
- Text is pattern-scanned before a maximum 200-character excerpt is persisted. Scanner exceptions
  or invalid return values store only `withheld: true`; exceptions and source bodies are not logged.
  Payloads contain source pointers, not full bodies. Credentials/profile/environment paths are denied.

## Real-file probe (2026-11-20)

Read one completed recent session JSONL from the pi sessions directory, and all five matching events/turns files under
`~/.pi/agent/context-budget`. Only counts were emitted; all SQLite files and the rotation copy
were private local artifacts, never committed.

| Source | Files | Entries / events / unique keys | Unread bytes / partial files | Catch-up time |
|---|---:|---:|---:|---:|
| Session JSONL | 1 | 27 / 27 / 27 | 0 / 0 | 18 ms |
| Context-budget events + turns | 5 | 1,742,108 / 1,742,108 / 1,742,108 | 0 / 0 | 39,489 ms |

Total: **1,742,135 events and unique keys**. Session replay read 27 entries, added zero rows.
Lag means bytes unread at the last descriptor-size snapshot, not end-to-end timestamp latency.
A local copy of the same session produced two rotation events and one truncation event:
30 total keys, zero added by identical-byte replay. Real sources were never written or locked.

### Observed writer rotation

From the context-budget extension's storage module (`src/storage.ts`):
Both `events.jsonl` and `turns.jsonl` rotate at 20 MiB before append. Rotation takes a
mkdir lock (`events.lock` / `turns.lock`, stale after 10 seconds), renames to
`<base>-YYYYMMDDTHHMMSSmmmZ[-NNN].jsonl`, then prunes (events: five archives; turns: two).
Appends reopen the active name. Rotation is best-effort and append itself is outside the lock;
old descriptors therefore must still be drained. The observed events archives included an
older 200,969,726-byte file: do not assume all archives respect today's threshold.

## Checks and reproduction

From repository root, both required gates passed (10 spike specs; 9 root specs):

```sh
~/.pi/agent/bin/pi-phase run --kind test --policy direct --label m0-ingestion --timeout 300 --log .ai-work/m0-ingestion/test.log -- node --test spikes/ingestion/
~/.pi/agent/bin/pi-phase run --kind test --policy direct --label m0-ingestion-root --timeout 300 --log .ai-work/m0-ingestion/root-test.log -- npm test
```

Probe (passed; substitutes explicit read-only source paths):

```sh
~/.pi/agent/bin/pi-phase run --kind test --policy direct --label m0-ingestion-real --timeout 300 --log .ai-work/m0-ingestion/real.log -- node spikes/ingestion/probe.ts "$HOME/.pi/agent/sessions/<project>/<session>.jsonl" "$HOME/.pi/agent/context-budget" <output-dir>
```

`git diff --cached --check` passed. No build, lint/format script, CI workflow or separate
integration suite is configured at root; no broader CI-equivalent build/lint gate was run.
The real-file/copy probe supplies the spike's integration evidence.

## Code Health

New files have no historical baseline; “initial” is the first review of this implementation.
Each source received `code_health_review` and one final `code_health_score`.

| File (`spikes/ingestion/`) | Initial | Final |
|---|---:|---:|
| `event-log.ts` | 10 | 10 |
| `tailer.ts` | 8.54 | 9.38 |
| `redact.ts` | 10 | 10 |
| `ingestion.test.ts` | 10 | 10 |
| `crash.ts` | Not scored (top-level only) | 10 |
| `probe.ts` | 9.68 | 9.68 |

Spike exception: `tailer.ts` remains below 9.5 after one decomposition pass.
Pre-commit safeguard flagged mean cyclomatic complexity 4.11 versus threshold 4;
its quality gate failed for that file. The second safeguard also flagged `probe.ts`'s
three-argument presence check as a complex conditional, despite its 9.68 score.
Both findings are reported spike exceptions. Carry the tailer complexity uplift into M1; no scoring loop.

## Boundaries and M1 recommendations

No tailer can recover bytes pruned before discovery, overwritten by unobserved truncation,
or a truncate/regrow that reaches the previous size between polls. The no-loss proof is
bounded to retained archives/descriptors and observed size drops, not arbitrary rewriting.
M1 needs retention-gap metrics, bounded backfill, polling/watch reconciliation, stable file epochs,
and single-ingester ownership; this spike retains every descriptor until close.

The 8 MiB batch limit stops on oversized lines; malformed complete entries stop without advancing.
Add explicit session/context schema-version guards, domain mapping and timestamp-lag metrics in M1.
The simple pattern scanner is **not** a production secret guarantee: use an audited scanner,
expand deny-list coverage, and re-scan source text whenever dereferencing pointers. Partial bytes
are durable only while the source/archive survives. Snapshot replay cannot establish identity
across a different copied inode; keys deliberately identify the actual source file.
