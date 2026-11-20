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

Sources: [Amp manual](https://ampcode.com/manual), [Conductor](https://conductor.build), [Crystal](https://github.com/stravu/crystal/) and [Nimbalyst](https://nimbalyst.com/crystal/), [Claude Squad](https://github.com/smtg-ai/claude-squad), [Vibe Kanban](https://github.com/BloopAI/vibe-kanban), [opencode TUI docs](https://opencode.ai/docs/tui/), [Langfuse](https://langfuse.com/docs/observability/overview), [LangSmith](https://docs.langchain.com/langsmith/observability), [Temporal Web UI](https://docs.temporal.io/web-ui), [Inngest run inspection](https://www.inngest.com/docs/platform/monitor/inspecting-function-runs), [Linear command menu](https://linear.app/changelog/2019-12-18-new-command-menu), [k9s](https://github.com/derailed/k9s), [lazygit](https://github.com/jesseduffield/lazygit), [Claude Code desktop](https://code.claude.com/docs/en/desktop), [Cursor agents window](https://cursor.com/docs/agent/agents-window), [GitHub Copilot agent management](https://docs.github.com/en/copilot/concepts/agent-capabilities/choosing-and-delegating-agent-work/agent-management).

## R2: TUI stack

See [ADR-0003](adr/0003-tui-stack-bake-off.md) for the full table. Summary: pi-tui is the best pi fit and the lowest widget set; OpenTUI has the highest TypeScript visual ceiling and is pre-1.0 (Bun or Node 26.4 with FFI); Bubble Tea v2 and Lip Gloss v2 give Charm polish and a single binary; Ratatui is strong and costly. Ink is weaker for full-screen UIs. The research ranking depended on weighting ecosystem fit first; with the owner's priority (visual quality first) the decision moved to an M0 bake-off.

Sources: [OpenTUI](https://opentui.com/) and its [runtime support](https://opentui.com/docs/getting-started/runtime-support/), [OpenTUI React guide](https://betterstack.com/community/guides/scaling-nodejs/opentui-react/), [opencode issue on the TUI migration](https://github.com/anomalyco/opencode/issues/30240), [Charm v2 announcement](https://charm.land/blog/v2/), [Ratatui](https://github.com/ratatui/ratatui), [Codex TUI manifest](https://github.com/openai/codex/blob/main/codex-rs/tui/Cargo.toml), [Ink](https://github.com/vadimdemedes/ink/), [Textual](https://github.com/Textualize/textual/), [Terminal.Gui v2](https://github.com/gui-cs/Terminal.Gui/releases/tag/v2.0.0). pi-tui facts come from inspecting the installed package and are not public links.

## R3: web stack and event store

- Chronicle: SQLite backend exists; a separate kernel process (Docker); about 320 to 425 MiB idle; needs certificates and admin bootstrap; no documented no-Docker distribution. Result: TS-native SQLite event log behind a port ([ADR-0001](adr/0001-event-sourced-console-sqlite-event-log.md)).
- Arc for TypeScript 1.0: Hono and Fastify adapters, Drizzle SQLite, observable queries over SSE, React client. Core needs Node >= 22; Chronicle package Node >= 22.19 ([ADR-0002](adr/0002-web-stack-node-arc-typescript-react.md)).
- Security patterns from Jupyter, Syncthing, Ollama and Home Assistant ([ADR-0006](adr/0006-security-model.md)).

Sources: [Chronicle](https://github.com/Cratis/Chronicle), [Arc for TypeScript](https://www.cratis.io/arc/backend/typescript/), [proxy generation](https://www.cratis.io/arc/backend/typescript/proxy-generation/getting-started/), [Arc queries on the frontend](https://www.cratis.io/arc/frontend/core/queries/integration/), [Cratis beyond .NET](https://blog.cratis.io/beyond-dotnet/), [Emmett](https://github.com/event-driven-io/emmett).

## R4: data sources

About seventeen sources (S1 to S17) already exist as files: session JSONL (30,451 files, 20 GB, about 300 MB/day), context-budget status and events, lane registry and status, lane messages, pi-orch store and inbox, question store, issue-work register, job logs, the phase queue ledger, subagent outputs, review logs, the watchdog board and handoff files. Properties that shape ingestion are in [ADR-0004](adr/0004-ingestion-tailers-over-existing-files.md). There is no HTTP or IPC endpoint in the current extensions. R4 is an inspection of a local pi setup (file layouts, counts and package source), so it has no public links; counts are as of the study date and should be re-measured.

Not verifiable from the notes: an exact per-source file count and format version for each source beyond the above; re-check each adapter against the live format when it is built.

## R5: integration

- **Direct**: MCP over streamable HTTP with PAT and tenant header; read tools for work, events, runners and questions; one write tool for answering; no dispatch or pause over MCP; checkout was stale, so re-verify ([ADR-0007](adr/0007-mcp-server-and-direct-adapter.md)).
- **pi extension API**: event hooks; `sendUserMessage` with steer or follow-up (always triggers a turn); `sendMessage` with steer, follow-up or next-turn for custom messages; abort; RPC and SDK modes only for processes the caller starts ([ADR-0005](adr/0005-live-session-integration-via-pi-extension.md)). This part comes from the installed pi version's type definitions and documentation.

Sources: Direct's MCP endpoint at `https://app.cratis.direct/mcp` (requires an account; tool list from the author's checkout, see ADR-0007).

## R6: web facts (primary-source checks)

- Local-server security guidance (OWASP, Jupyter, Syncthing, Ollama, Home Assistant, Tailscale Serve and Funnel): loopback bind is not enough; validate Host; require a secret; CORS is not authentication; use a tailnet for remote access. UNVERIFIED: code-server defaults, Open WebUI, Home Assistant login model.
- Node `node:sqlite` is a release candidate (Stability 1.2) in current docs; the exact release is UNVERIFIED because two changelogs differ. `bun:sqlite` and `better-sqlite3` were not checked.
- Emmett's SQLite event store is marked beta.

Sources: [OWASP DNS rebinding](https://wstg.owasp.org/latest/4-Web_Application_Security_Testing/11-Client-side/21-DNS_Rebinding/), [Jupyter Server security](https://jupyter-server.readthedocs.io/en/latest/operators/security.html), [Jupyter on disabling authentication](https://blog.jupyter.org/posts/2022/please-dont-disable-authentication-in-jupyter-servers/), [Syncthing REST API](https://docs.syncthing.net/dev/rest.html), [Syncthing GUI listen address](https://docs.syncthing.net/users/guilisten.html), [Syncthing HTTP services](https://docs.syncthing.net/dev/http-services.html), [Ollama environment config](https://github.com/ollama/ollama/blob/main/envconfig/config.go), [Ollama API introduction](https://github.com/ollama/ollama/blob/main/docs/api/introduction.mdx), [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve), [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel), [Node.js SQLite](https://nodejs.org/api/sqlite.html), [Emmett SQLite store](https://event-driven-io.github.io/emmett/event-stores/sqlite.html).

## Context-memory study (inputs)

33 days of sessions: 657 sessions with a reset, 171 with three or more, 95 with ten or more, one coordinator at 136; only about 46% of a directive's life survives in any wording after resets; confirmed harm from a dropped directive; the summary is the sole carrier of intent. The study's decision is the intent-memory store (journal, answers, events, boundary events) with human-verbatim directives and fail-closed redaction. See [ADR-0008](adr/0008-relationship-to-intent-memory.md) and [vision](vision.md).

## Open research gaps

- Star counts and releases for OpenTUI, Ink, Bubble Tea and Ratatui.
- TUI testing support and single-binary distribution for OpenTUI.
- `bun:sqlite` and `better-sqlite3` documentation.
- Whether Arc's proxy generator is published to npm.
- Current Direct MCP tool list and scope decisions.
- Primary rationale from Anthropic and OpenAI for their TUI stacks.
