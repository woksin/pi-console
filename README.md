# pi-console

A persistent, keyboard-first console for a local [pi](https://github.com/earendil-works/pi) setup: every session, lane, orchestrator, subagent, question, answer and message in one place, with a web UI and a terminal UI over the same event-sourced store.

> Status: design. This repository currently contains the Phase 2 design documents only. There is no code yet. The name `pi-console` is provisional.

## Why

Long-running pi work is spread over many sessions and lanes, and each session resets its context many times. Two things go wrong:

1. **Answers are lost.** A reset (compaction or handoff) can drop the answer to a prompt you asked, or cut the session off mid-prompt, and you never get the result.
2. **Nothing shows the whole picture.** Truth is spread over roughly ten file stores (session JSONL, lane registry, message files, question store, job logs, queue ledgers). No view says which session needs you, which is stuck, and which request is still unanswered.

In a recent study of 33 days of local sessions, 657 sessions had at least one context reset, 95 had ten or more, and one orchestrator session had 136 [context-memory study, final report §2]. The study traced the root cause to a model-rewritten summary being the only carrier of long-lived intent. pi-console is the human-facing half of the fix: a durable view that never loses a request or an answer, and a place to act on them.

## What it will do

- Show a **Needs you** inbox first: open questions, unanswered or interrupted requests, blocked lanes.
- Show the **fleet**: sessions, lanes, orchestrators and subagents with fixed status semantics.
- Keep a **never-lost log** of every human request and the answer to it, including requests cut off by a reset.
- Show a **live transcript** per session with reset markers, jobs, subagents and context pressure.
- Let you **intervene**: answer questions, steer or queue a message, pause or abort, with a full audit trail (milestone M2).
- Run as a **local daemon** on `127.0.0.1`; opt-in remote access through Tailscale Serve or a TLS reverse proxy (milestone M3).
- Expose a read-mostly **MCP server** and, later, a **Cratis Direct** adapter (milestone M4).

Everything is derived from an append-only event log, so every screen can be rebuilt by replay, every intervention is audited, and the log can later be analysed to improve the setup.

## Screenshots

A coloured terminal tour of the TUI against the mock daemon: [docs/media/tui/tour-colour.cast](docs/media/tui/tour-colour.cast) (`asciinema play`); the pictures are in [docs/ui-tui.md](docs/ui-tui.md). Web screenshots will follow with the daemon-backed web UI. ASCII wireframes are in [docs/information-architecture.md](docs/information-architecture.md).

## Quick start (planned)

```bash
npm install -g pi-console
pi-console daemon          # start the local daemon (127.0.0.1)
pi-console open            # open the web UI with a one-time token exchange
pi-console tui             # full-screen terminal UI
pi-console install-service # print/install launchd, systemd or Windows service setup
pi-console token           # show, rotate or scope the per-install token
```

These commands do not exist yet; see [docs/milestones.md](docs/milestones.md).

## Documentation

| Document | Content |
|---|---|
| [docs/index.md](docs/index.md) | Table of contents and reading order |
| [docs/vision.md](docs/vision.md) | Problem, vision, principles, personas, non-goals |
| [docs/information-architecture.md](docs/information-architecture.md) | Entities, navigation, status taxonomy, screens (web and TUI), keyboard map, visual style |
| [docs/event-model.md](docs/event-model.md) | Event catalogue, projections, idempotency, schema evolution, privacy, MVP slices |
| [docs/architecture.md](docs/architecture.md) | Components, process model, packages, data directories, budgets, testing |
| [docs/security.md](docs/security.md) | Threat model and controls |
| [docs/milestones.md](docs/milestones.md) | M0 to M5 with acceptance criteria |
| [docs/research-summary.md](docs/research-summary.md) | Research findings with sources |
| [docs/adr/](docs/adr/) | Architecture decision records 0001 to 0009 |

## License

To be decided before the repository is published.
