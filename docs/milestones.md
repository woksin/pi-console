# Milestones

Each milestone is shippable on its own and has acceptance criteria. Durations are estimates (UNVERIFIED) and should be revisited after M0.

## M0: spikes and visual bake-off

Goal: remove the biggest unknowns before committing to a stack.

**Spikes**

| Spike | Question | Done when |
|---|---|---|
| Arc.TS end to end | Do Arc for TypeScript, Hono, Drizzle SQLite, an observable query over SSE and generated proxies work together ([ADR-0002](adr/0002-web-stack-node-arc-typescript-react.md))? | A demo page shows a live-updating list; proxy generator availability is confirmed or the fallback is chosen |
| SQLite driver | `node:sqlite` or `better-sqlite3` behind the `EventLog` port ([ADR-0001](adr/0001-event-sourced-console-sqlite-event-log.md)) | Append and replay 1 M events, WAL, measured; driver chosen |
| Ingestion | Tail a real session JSONL and the context-budget event files without loss across rotation | Replay produces identical event keys twice |
| Extension channel | Outbound WebSocket from a pi extension; deliver one `interject` in steer mode and one in follow-up mode ([ADR-0005](adr/0005-live-session-integration-via-pi-extension.md)) | Round trip proven on a scratch session; question-store verbatim check behaviour recorded |
| Daemon API contract | Specify the HTTP and SSE contract and an OpenAPI or JSON Schema description | Two throwaway clients (TypeScript and one non-TypeScript) use it |

**TUI visual bake-off** ([ADR-0003](adr/0003-tui-stack-bake-off.md))

Priority: visual quality first, UX and interaction quality second, everything else after.

- Candidates: OpenTUI (React renderer), Bubble Tea v2 + Lip Gloss v2, pi-tui as the pi-fit baseline. Add Ratatui only if the first results are inconclusive.
- Build the **same two screens** in each of the top two or three stacks: (1) fleet overview, (2) session detail with a live streaming transcript. Both read the daemon API, fed by a **recorded fixture stream** so every stack shows identical data. The fixture contains: 30 sessions across 6 repositories, a reset marker with carried requests, an interrupted request, a context-pressure sparkline, and a transcript that streams at a realistic rate.
- Required in each: true-colour theme with a gradient and degrade to 256 and 16 colours; split panes; mouse (click, scroll); a command-palette overlay; smooth streaming; terminal resize.
- Compare: screenshots at 120x36 and 200x50, terminal recordings (for example asciinema or VHS), frame time and CPU while streaming 5,000 lines/s, input latency, code size and time to build.
- Output: a short report in `docs/` with the side-by-side screenshots and recordings, a scored table in the criteria order, and the ADR-0003 status changed to Accepted with the winner.
- Time-box: one to two weeks for three stacks (UNVERIFIED). Stop a candidate early if it cannot draw the graph canvas or swimlane glyphs acceptably.

**Acceptance (M0)**: spikes answered in writing; bake-off report reviewed by the owner; ADR-0001 driver and ADR-0003 stack decided; API contract v0 published.

## M1: read-only console (web and TUI)

Scope: the MVP slices listed in [event-model.md](event-model.md#mvp-slices).

- Daemon with SQLite event log, checkpoints, backfill (14 days), loopback bind, token auth, Host and Origin checks ([security](security.md)).
- Source adapters for sessions, context-budget, lanes and messages, question store, jobs and phases.
- Views: Overview ("Needs you"), Fleet, Session detail, Requests and answers, Questions (read-only), Messages list, Settings.
- Request and answer derivation from session JSONL ([ADR-0008](adr/0008-relationship-to-intent-memory.md) Phase A).
- Web UI and the TUI chosen in M0, same status taxonomy and keyboard map.

**Acceptance (M1)**:

- Replaying the event log from empty reproduces every read model byte for byte (spec).
- Killing the daemon at any point and restarting loses no events and creates no duplicates (spec).
- On a real week of sessions, every human prompt appears with its answer or an explicit unanswered or interrupted state; a hand-checked sample of 30 shows no wrong pairing beyond what the UI labels as uncertain.
- No secret from a fixture set of known secret shapes appears in the database or in any API response.
- Cold start to first screen under 3 seconds with a 14-day backfill running in the background (target, UNVERIFIED); idle daemon memory under 150 MiB (target, UNVERIFIED).
- Requests with no valid token, wrong Host or foreign Origin are refused (specs).

## M2: live transcript and interventions

- The `pi-console` extension: live status and streaming transcript ([ADR-0005](adr/0005-live-session-integration-via-pi-extension.md)).
- Intervention composer: answer, steer, follow-up, next turn, pause, abort, with audit log and receipts.
- Question answering from the console through the question store's own path.
- Signature views: communication graph, swimlane timeline, inline-answer inbox, command palette ([information architecture](information-architecture.md#5-signature-views)).

**Acceptance (M2)**:

- A steer sent from the console appears in the target session within 2 seconds and is recorded with actor, origin, token id and result.
- No intervention is delivered during a handoff in progress (queued instead), to a subagent, or after its time to live (specs).
- Abort requires typed confirmation and a control-scope token.
- A question answered in the console is recorded by the question store exactly as if answered in its own tool, or the limitation is documented and the answer path is blocked.
- Streaming transcript keeps up with a busy session without frame drops in the chosen TUI (frame time budget from the bake-off).

## M3: remote access and self-host

- Optional remote access through Tailscale Serve or a TLS reverse proxy with trusted-proxy configuration.
- Self-host auth: passkeys or OIDC with a single-owner allowlist; token scopes and rotation UI.
- Phone-friendly "Needs you" layout; desktop notifications.
- Rate limits, session management, audit export.

**Acceptance (M3)**: a documented setup reaches the console from a second device without exposing it publicly; a security review of the remote path finds no blocking issues; the DNS-rebinding, CSRF and cross-origin specs pass against the proxy setup.

## M4: MCP server and Direct adapter

- Console MCP server ([ADR-0007](adr/0007-mcp-server-and-direct-adapter.md)): read tools and ask-only writes.
- Direct adapter, read-only first, then question answer when permitted; Direct and runners panel.
- Intent-memory store ingestion (Phase B of [ADR-0008](adr/0008-relationship-to-intent-memory.md)) once the store exists.

**Acceptance (M4)**: re-verified Direct tool list recorded; a non-pi MCP client reads open requests; Direct events appear in the console with cursor checkpoints; no dispatch or pause control exists for Direct.

## M5: learning and polish

- Analysis over the event log: reset statistics, lost-request rate, intervention outcomes, token and cost trends (btop-style panels).
- Retention and archival of old events and blobs; export.
- Optional Chronicle adapter behind the `EventLog` port.
- Themes, accessibility audit, documentation site, public release (name and visibility need owner approval).

**Acceptance (M5)**: accessibility checklist passed (keyboard complete, contrast, reduced motion); retention keeps the database under its configured size with no loss of requests and answers; the conformance suite passes against both event log adapters if the Chronicle adapter ships.

## Dependencies and order

M0 gates everything. Within M1 the daemon, ingestion and web UI start immediately; TUI work starts when ADR-0003 is accepted. M2 depends on the extension spike. M3 and M4 are independent after M2. The intent-memory store ships on its own schedule; Phase A of the request view does not depend on it.
