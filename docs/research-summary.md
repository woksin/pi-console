# Research summary

Findings behind the design. Six research notes (R1 to R6) and the context-memory study fed these documents. Claims marked **UNVERIFIED** were not confirmed from a primary source. Search was partly rate-limited, so several star counts and versions were not checked.

## R1: prior art and UX

Patterns worth copying, from products inspected:

- **Needs-attention first**: Amp notifies when a thread is ready for your next message; Conductor and Claude Squad show many agents in one view with isolated workspaces.
- **Steer versus queue**: opencode separates "steer the active session" (Enter) from "queue the prompt" (Ctrl+X, Enter), with a command palette for every action (Ctrl+P) and revert of the last turn. The composer in [information-architecture.md](information-architecture.md#55-intervention-composer) follows this.
- **Review before apply**: Claude Squad lets you review changes before applying; Vibe Kanban supports inline diff comments sent to the agent (Vibe Kanban is sunsetting; do not use it as a reference product). Crystal is deprecated in favour of Nimbalyst.
- **Traces**: Langfuse, LangSmith and Phoenix present a run as a trace of model calls, tool use and latency; Temporal has saved views and a pre-built "Task Failures" view; Inngest warns to check completed side effects before a replay or rerun, which informs the confirmation text for abort and re-ask.
- **Dense UX**: Linear's command menu ranks actions by the current view; k9s uses fixed semantic colours and mnemonic key hints; lazygit and btop show dense panels with a footer of keys and live charts.
- **Gap**: none of the surveyed tools has a durable "request and answer log that survives context resets". That is this product's differentiator.

## R2: TUI stack

See [ADR-0003](adr/0003-tui-stack-bake-off.md) for the full table. Summary: pi-tui is the best pi fit and the lowest widget set; OpenTUI has the highest TypeScript visual ceiling and is pre-1.0 (Bun or Node 26.4 with FFI); Bubble Tea v2 and Lip Gloss v2 give Charm polish and a single binary; Ratatui is strong and costly. Ink is weaker for full-screen UIs. The research ranking depended on weighting ecosystem fit first; with the owner's priority (visual quality first) the decision moved to an M0 bake-off.

## R3: web stack and event store

- Chronicle: SQLite backend exists; a separate kernel process (Docker); about 320 to 425 MiB idle; needs certificates and admin bootstrap; no documented no-Docker distribution. Result: TS-native SQLite event log behind a port ([ADR-0001](adr/0001-event-sourced-console-sqlite-event-log.md)).
- Arc for TypeScript 1.0: Hono and Fastify adapters, Drizzle SQLite, observable queries over SSE, React client. Core needs Node >= 22; Chronicle package Node >= 22.19 ([ADR-0002](adr/0002-web-stack-node-arc-typescript-react.md)).
- Security patterns from Jupyter, Syncthing, Ollama and Home Assistant ([ADR-0006](adr/0006-security-model.md)).

## R4: data sources

About seventeen sources (S1 to S17) already exist as files: session JSONL (30,451 files, 20 GB, about 300 MB/day), context-budget status and events, lane registry and status, lane messages, pi-orch store and inbox, question store, issue-work register, job logs, the phase queue ledger, subagent outputs, review logs, the watchdog board and handoff files. Properties that shape ingestion are in [ADR-0004](adr/0004-ingestion-tailers-over-existing-files.md). There is no HTTP or IPC endpoint in the current extensions.

Not verifiable from the notes: an exact per-source file count and format version for each source beyond the above; re-check each adapter against the live format when it is built.

## R5: integration

- **Direct**: MCP over streamable HTTP with PAT and tenant header; read tools for work, events, runners and questions; one write tool for answering; no dispatch or pause over MCP; checkout was stale, so re-verify ([ADR-0007](adr/0007-mcp-server-and-direct-adapter.md)).
- **pi extension API**: event hooks and message injection with steer, follow-up and next-turn modes; abort; RPC and JSON modes only for self-started processes ([ADR-0005](adr/0005-live-session-integration-via-pi-extension.md)).

## R6: web facts (primary-source checks)

- Local-server security guidance (OWASP, Jupyter, Syncthing, Ollama, Home Assistant, Tailscale Serve and Funnel): loopback bind is not enough; validate Host; require a secret; CORS is not authentication; use a tailnet for remote access. UNVERIFIED: code-server defaults, Open WebUI, Home Assistant login model.
- Node `node:sqlite` is a release candidate (Stability 1.2) in current docs; the exact release is UNVERIFIED because two changelogs differ. `bun:sqlite` and `better-sqlite3` were not checked.
- Emmett's SQLite event store is marked beta.

## Context-memory study (inputs)

33 days of sessions: 657 sessions with a reset, 171 with three or more, 95 with ten or more, one coordinator at 136; only about 46% of a directive's life survives in any wording after resets; confirmed harm from a dropped directive; the summary is the sole carrier of intent. The study's decision is the intent-memory store (journal, answers, events, boundary events) with human-verbatim directives and fail-closed redaction. See [ADR-0008](adr/0008-relationship-to-intent-memory.md) and [vision](vision.md).

## Open research gaps

- Star counts and releases for OpenTUI, Ink, Bubble Tea and Ratatui.
- TUI testing support and single-binary distribution for OpenTUI.
- `bun:sqlite` and `better-sqlite3` documentation.
- Whether Arc's proxy generator is published to npm.
- Current Direct MCP tool list and scope decisions.
- Primary rationale from Anthropic and OpenAI for their TUI stacks.
