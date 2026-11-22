# Architecture

## 1. Components

```text
 pi sessions ──(files: JSONL, status, messages, questions, jobs, ledgers)──┐
      │                                                                     v
      └─ pi-console extension ──ws (outbound)──►  ┌─────────────── daemon (Node >= 26) ───────────────┐
                                                  │ source adapters → ingestion → EventLog (SQLite)   │
 Direct (MCP, optional) ◄── adapter ─────────────►│ projector → read models → HTTP + SSE API          │
                                                  │ command bus → interventions → extension / stores  │
                                                  │ MCP server (read-mostly)                          │
                                                  └───────┬──────────────┬──────────────┬─────────────┘
                                                          │              │              │
                                                      web UI (React)   TUI client    MCP clients
```

| Component | Responsibility |
|---|---|
| Source adapters | Read-only tailers and watchers over existing files ([ADR-0004](adr/0004-ingestion-tailers-over-existing-files.md)); produce candidate events and checkpoints |
| Ingestion | Redaction (fail closed), idempotent append, checkpoint in one transaction |
| `EventLog` port | `append`, `readFrom`, `subscribe`; `SqliteEventLog` by default ([ADR-0001](adr/0001-event-sourced-console-sqlite-event-log.md)) |
| Projector | Pure reducers into read models (SQLite tables) |
| API | HTTP queries and commands, SSE observable queries; single contract for all clients |
| Command bus | Validates and records interventions, routes them to the extension, the question store or a lane message |
| Extension gateway | WebSocket endpoint for the pi extension ([ADR-0005](adr/0005-live-session-integration-via-pi-extension.md)) |
| MCP server | Read tools and ask-only writes ([ADR-0007](adr/0007-mcp-server-and-direct-adapter.md)) |
| Web UI | React single-page app served by the daemon |
| TUI | A client of the daemon API; stack decided in M0 ([ADR-0003](adr/0003-tui-stack-bake-off.md)) |

The TUI and the web UI hold no business logic and never touch the database.

## 2. Process model

- One long-lived daemon process per user. Start it with `pi-console daemon`. `pi-console install-service` is not implemented yet; for background supervision, configure your own launchd or systemd unit to run `pi-console daemon`.
- The daemon binds `127.0.0.1` on a configurable port; a second unix socket (0600) may serve the extension and the CLI.
- Ingestion, projection and API run in one process. If backfill load affects the UI, backfill moves to a worker thread (decision deferred to M1 measurements).
  Backfill order and pacing (P1b volume): sessions first, then the other sources one at a time, smallest first; every source yields to the event loop after each 64 KiB batch, and shutdown aborts a running backfill at the next batch. Measured on a copy of a real tree, `/health` stayed under 200 ms with this single-process design (adapters README, "Scope and windows").
- The extension runs inside each pi session and is an outbound client only.

## 3. Package layout

npm workspace ([ADR-0009](adr/0009-packaging-and-distribution.md)). Names are provisional.

| Package | Content |
|---|---|
| `packages/events` | Event types, schemas, upcasters, theme and status tokens |
| `packages/core` | `EventLog` port, SQLite implementation, projections, derivation of requests and answers |
| `packages/adapters` | Source adapters, one folder per source, with fixture-based specs |
| `packages/daemon` | HTTP and SSE API, command bus, extension gateway, MCP server, auth |
| `packages/web` | React UI |
| `packages/tui` | TUI client (language and layout depend on the bake-off) |
| `packages/extension` | The pi extension |
| `packages/cli` | The published `pi-console` command |
| `docs/` | These documents |

Vertical slices inside packages: each slice keeps its event, adapter, projection and view together where the framework allows ([event model](event-model.md#7-mvp-slices)).

## 4. Data directory

The daemon resolves the data directory in this order: explicit `--data-dir`, then `PI_CONSOLE_DATA_DIR`, then `~/.pi-console`. The TUI and extension also honour `PI_CONSOLE_DATA_DIR`; set it for each process when sharing a custom directory. Permissions 0700 for the directory.

| Path | Content |
|---|---|
| `events.db` (+ `-wal`, `-shm`) | Event log and read models (0600) |
| `config.json` | Sources, backfill window, retention, remote settings |
| `token` | Owner token (0600); scoped tokens stored hashed in the database |
| `blobs/` | Durable redacted copies of volatile sources (subagent outputs, workflow journals), written as the source files grow ([ADR-0004](adr/0004-ingestion-tailers-over-existing-files.md)); subject to the retention settings |
| `logs/` | Daemon logs, rotated |

## 5. Performance and size budgets

Targets to be confirmed in M0 and M1; all UNVERIFIED until measured.

| Budget | Target |
|---|---|
| Idle memory | under 150 MiB |
| Cold start to first screen | under 3 s, backfill in the background |
| Live latency, file write to screen | under 1 s |
| Backfill rate | at least 20 MB/s of session JSONL on a laptop; 14 days is about 4 GB at the measured 300 MB/day |
| Database size | events hold pointers and excerpts, not bodies, to keep the database in the low GBs for 14 days |
| TUI redraw | at most 30 frames per second, no frame over 33 ms during streaming |

Facts behind the numbers: 30,451 session files totalling 20 GB, and about 300 MB per day [R4]. File-size distribution (median, tail) was not measured: UNVERIFIED. Session bodies are read lazily from the source file by offset, not copied.

## 6. Testing strategy

- **Event log and projections**: spec-driven, replay tests (replay from empty equals incremental), crash and restart tests, idempotency tests.
- **Adapters**: fixtures recorded from real files with secrets removed, including torn last lines, rotation, atomic rename and unknown schema versions.
- **Contract tests**: the daemon API contract is checked against the web client, the TUI client and the MCP server; if the TUI is not TypeScript, a conformance test runs the generated client against the daemon.
- **Security specs**: Host, Origin, CSRF, token, scope, redaction and fail-closed cases ([security](security.md)).
- **UI**: web component tests and a small set of end-to-end flows with a browser driver against fixture data; TUI tests use a headless terminal emulator and screen snapshots (the pi-tui `VirtualTerminal` helper is not published, so use `@xterm/headless` or the chosen stack's test support).
- **Visual regression**: screenshot and recording fixtures from the bake-off double as reference for the signature views.
- **Real-world check**: run the console against a copy of a real week of sessions before each milestone sign-off.

## 7. Observability of the console itself

Structured logs, a `/health` endpoint (adapters, lag per source, queue depth, database size), and the Settings view showing the same. No telemetry leaves the machine.
