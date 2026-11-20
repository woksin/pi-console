# ADR-0004: Ingestion through tailers and watchers over existing files

- Status: Accepted
- Date: 2026-11-20

## Context

All coordination between pi tools today is files, locks and signals; no HTTP or IPC endpoint exists in the extensions, lib, bin or local packages [R4 "HTTP / IPC endpoints"]. The console needs history (30,451 session files, 20 GB, about 300 MB/day) and live data. Facts that shape ingestion [R4]:

- Session JSONL is append-only with a single writer and no lock files; a partial last line is possible.
- Several files are rewritten by atomic rename (status JSON, lanes registry, board); others are exclusive-create (lane messages, question revisions).
- Many processes append to the same context-budget event files, which rotate under a lock; consumers must reopen on replacement.
- Subagent outputs live in a volatile temp directory with no retention by pi.
- Session tool results can contain secrets; the input-side mask does not cover them.

## Options

1. Only a pi extension emitting events live.
2. Only tailers and watchers over existing files.
3. Tailers first; add the extension later for live data that never reaches files (token streaming).

## Decision

Option 3, tailers first.

- One **source adapter** per source (S1 to S17 in the [research summary](../research-summary.md)). An adapter turns source facts into candidate events with an **idempotency key** derived from (source, file identity, byte offset or entry id, event type). Replaying the same bytes yields the same keys, so the unique index makes ingestion idempotent.
- A **checkpoint per source** (file id by inode and path, offset, size, mtime) is stored in the database, in the same transaction as the appended events.
- Strategies by file kind: tail with inode and offset for append-only JSONL (buffer until newline); directory watch for exclusive-create files; poll or watch plus content hash for atomic-rename JSON; handle rotation by inode change or size drop; never take write locks (probe locks only non-blocking and shared).
- **Backfill** is bounded by a configurable window (default 14 days) and runs in the background at low priority; older files are indexed by (path, size, mtime) and loaded only on demand.
- **Read-only**: adapters never modify, move or delete source files. Writing back goes through each tool's own path (question answers through the question store's CLI or actions).
- **Never read** credentials: the auth file, account profile directories, browser profiles and environment files are on a deny list in the adapters [R4 "Secrets"].
- **Redact at ingestion**: text is scanned before it enters an event or a read model; if scanning fails the text is withheld (fail closed, contract invariant 4). Event payloads carry pointers (file, offset, entry id) rather than copies of large bodies.
- Later, the `pi-console` extension emits first-class events live ([ADR-0005](0005-live-session-integration-via-pi-extension.md)); tailers remain the fallback and the source for sessions without the extension. Duplicate facts from both paths collapse by idempotency key where the key can be matched, otherwise the projection prefers the extension event and marks the file-derived one as corroboration.

## Consequences

- Works with today's pi setup without changing any other repository.
- Ingestion lag is visible per source and shown in the UI.
- A large, careful ingestion layer (17 sources) is the main implementation risk; the MVP covers sessions, context-budget, lanes and messages, question store, jobs and phases ([milestones](../milestones.md)) and defers the rest.
- Volatile sources (subagent outputs) must be indexed early or snapshotted on first sight.
- Source formats are owned by other tools and can change; each adapter has fixture-based specs and a schema-version guard that stops and reports on an unknown version instead of guessing.
