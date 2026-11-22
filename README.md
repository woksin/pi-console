<div align="center">

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/media/hero-light.webp">
  <img src="docs/media/hero-dark.webp" alt="pi-console: the web Overview with a Needs you inbox, a fleet status strip and a context-pressure histogram, and the terminal UI laid over it" width="900">
</picture>

**A persistent, keyboard-first console for a local [pi](https://github.com/earendil-works/pi) setup.**<br>
Every session, lane, orchestrator, subagent, question, answer and message in one place, in a web UI and a terminal UI over the same event-sourced store.

[![CI](https://github.com/woksin/pi-console/actions/workflows/ci.yml/badge.svg)](https://github.com/woksin/pi-console/actions/workflows/ci.yml)
![Node 26+](https://img.shields.io/badge/node-%E2%89%A5%2026-3c873a)
![Read-only M1](https://img.shields.io/badge/milestone-M1%20read--only-66d9ef)

[Tour](#tour) · [Quick start](#quick-start) · [Architecture](#architecture) · [Security](#security-model) · [Docs](#documentation)

</div>

> The name `pi-console` is provisional. All pictures in this repository are generated from synthetic demo data (see [Demo data](#demo-data-and-regenerating-the-media)).

## Why

Long-running pi work is spread over many sessions and lanes, and each session resets its context many times. Two things go wrong:

1. **Answers are lost.** A reset (compaction or handoff) can drop the answer to a prompt you asked, or cut the session off mid-prompt, and you never get the result.
2. **Nothing shows the whole picture.** Truth is spread over roughly ten file stores (session JSONL, lane registry, message files, question store, job logs, queue ledgers). No view says which session needs you, which is stuck, and which request is still unanswered.

In a recent study of 33 days of local sessions, 657 sessions had at least one context reset, 95 had ten or more, and one orchestrator session had 136 [context-memory study, final report §2]. pi-console is the human-facing half of the fix: a durable view that never loses a request or an answer.

## Tour

### Needs you first

The Overview opens on what needs a human: open requests, answers you may not have seen, blocking questions, blocked lanes. The header's **fleet pulse** and the **context-pressure histogram** show the whole fleet at a glance, and the tab title carries the count.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/media/web-overview-light.webp">
  <img src="docs/media/web-overview.webp" alt="Web Overview titled 19 things need you: status counts, a context-pressure histogram and grouped open requests and blocking questions" width="900">
</picture>

<img src="docs/media/web-pulse.webp" alt="Close-up of the fleet pulse strip, the status counts and the context-pressure histogram that marks six sessions above 80 percent" width="900">

### Fleet

Sessions, lanes, orchestrators and subagents with fixed status semantics, so a glyph and colour always mean the same thing in both clients.

<img src="docs/media/web-fleet.webp" alt="Fleet table grouped by repository with status badges, context bars, trend sparklines, model and cost per session" width="900">

### Resets, shown where they happen

Every context reset is an inline `⟲` divider in the transcript: what kind it was, which requests were **carried over** and which were **interrupted**. Nothing is lost silently.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/media/web-session-resets-light.webp">
  <img src="docs/media/web-session-resets.webp" alt="Session transcript with a highlighted handoff reset divider listing two carried-over requests and one interrupted request, next to the context and resets panels" width="900">
</picture>

### Command palette

`Ctrl+P` or `:` opens a palette with typed groups (commands, sessions, lanes, questions). `>` filters to commands, `@` to sessions and lanes, `#` to questions and requests, `/` to messages.

<img src="docs/media/web-palette.gif" alt="Animation: Ctrl+P opens the palette, typing aur lists matching sessions, lanes and questions in groups, Enter opens the selected session" width="900">

### Keyboard tour

Everything is reachable from the keyboard: `1`-`7` switch views, `j`/`k` move, `Enter` opens, `Esc` goes back, `?` shows the map.

<img src="docs/media/web-tour.gif" alt="Animation: Overview, then Fleet, then a session scrolled to its reset divider, then the Timeline, all switched with number keys" width="900">

### Timeline and graph

One time axis for requests, answers, resets, questions and messages; and a messages graph of who talked to whom, nodes coloured by status.

<img src="docs/media/web-timeline.webp" alt="Timeline of lanes grouped by repository with request, answer, reset, question and message markers on one time axis" width="900">
<img src="docs/media/web-graph.webp" alt="Messages graph for two repositories: orchestrator and subagent nodes coloured by status, with message and spawn edges" width="900">

### Themes

Midnight (default), dawn and high contrast, with a live preview in Settings. Status never relies on colour alone: every status has a glyph.

<img src="docs/media/web-themes.webp" alt="Settings theme preview cards for midnight, dawn and contrast showing the status colours, text tones and the pressure gradient" width="720">

### Every web view, both themes

| View | Midnight (dark) | Dawn (light) |
|---|---|---|
| Overview | [Screenshot](docs/media/web-overview.webp) | [Screenshot](docs/media/web-overview-light.webp) |
| Fleet | [Screenshot](docs/media/web-fleet.webp) | [Screenshot](docs/media/web-fleet-light.webp) |
| Requests | [Screenshot](docs/media/web-requests.webp) | [Screenshot](docs/media/web-requests-light.webp) |
| Questions | [Screenshot](docs/media/web-questions.webp) | [Screenshot](docs/media/web-questions-light.webp) |
| Messages list | [Screenshot](docs/media/web-messages.webp) | [Screenshot](docs/media/web-messages-light.webp) |
| Messages graph | [Screenshot](docs/media/web-graph.webp) | [Screenshot](docs/media/web-graph-light.webp) |
| Timeline | [Screenshot](docs/media/web-timeline.webp) | [Screenshot](docs/media/web-timeline-light.webp) |
| Work | [Screenshot](docs/media/web-work.webp) | [Screenshot](docs/media/web-work-light.webp) |
| Session detail | [Screenshot](docs/media/web-session.webp) | [Screenshot](docs/media/web-session-light.webp) |
| Settings | [Screenshot](docs/media/web-settings.webp) | [Screenshot](docs/media/web-settings-light.webp) |

### The terminal UI

The same views, models and keymap in a terminal. It runs on [OpenTUI](https://github.com/sst/opentui) and talks to the daemon over the same loopback API.

<img src="docs/media/tui-tour.gif" alt="Animation of the terminal UI: Overview, Fleet, a session filtered to its reset divider, the command palette and the Timeline" width="900">

A [VHS tape](scripts/media/tui.tape) also records the real TUI against the isolated demo daemon:

<img src="docs/media/tui-vhs.gif" alt="VHS recording of the terminal UI against the synthetic demo daemon: Overview, Fleet, Requests and Settings" width="880">

<img src="docs/media/tui-overview.webp" alt="Terminal UI Overview with the needs-you inbox on the left and fleet status bars, average context and the context-pressure histogram on the right" width="900">

<img src="docs/media/tui-palette.webp" alt="Terminal UI command palette listing sessions, lanes and questions that match aur, with the matching letters underlined" width="900">

<img src="docs/media/tui-session-resets.webp" alt="Terminal UI transcript filtered to a handoff reset divider with its carried and interrupted requests" width="900">

It also has a **mono** theme (`PI_CONSOLE_THEME=mono`, or `NO_COLOR`) where status is carried by glyphs and weight only:

<img src="docs/media/tui-mono.webp" alt="Terminal UI Fleet view in the mono theme: no colour, status shown by glyphs such as bang, cross, tilde and check mark" width="900">

## Quick start

Requires Node.js 26 or newer.

```bash
npm ci
```

### Try it

```bash
npm run demo
```

This builds the web bundle, generates synthetic data and starts the **real daemon** on a free loopback port. Nothing is read from your pi directories and no live agents are connected. Open the printed web URL, then paste the contents of the printed token file into the connection screen. The token is never printed or included in the URL. The launcher also prints a command for opening the TUI in a second terminal against the same daemon.

Press **Ctrl-C** in the demo terminal to stop it and remove its temporary data and token. Each run starts fresh. The synthetic event log is static; the separate developer mock remains available with `npm start`.

**Run it on your own pi data** (read-only by default; it reads `~/.pi/agent` and keeps its own store in `~/.pi-console`):

```bash
npm run build -w @pi-console/web
node packages/cli/bin/pi-console.mjs daemon --web-dist packages/web/dist   # prints the URL; the token is ~/.pi-console/token
node packages/cli/bin/pi-console.mjs tui                                    # in a second terminal
```

Memory review is a narrow opt-in exception: with daemon review enabled, a separate `memory-control-token` and a ready owning interactive pi provider, both consoles can request **Confirm…** / **Reject…**. Every request requires native human confirmation in pi and then canonical producer ingestion; the console never writes memory directly. The ordinary token remains read-only, with exact command fallback and reasons when review is unavailable. See [web memory review](docs/ui-web.md#memory-review) and [TUI memory review](docs/ui-tui.md#memory-review) for credential setup and controls.

`pi-console daemon --help` lists the data directory, port and source options. Interventions (answering, steering, pausing) are milestone M2; there is no global install yet.

CLI errors print a short message to stderr and exit non-zero. Set `PI_CONSOLE_DEBUG=1` to include a stack trace for diagnosis (for example, `PI_CONSOLE_DEBUG=1 pi-console daemon --port banana`).

## Architecture

```mermaid
flowchart LR
  subgraph pi["pi, on your machine"]
    files["session JSONL, lanes, messages,<br/>questions, jobs, ledgers"]
    ext["pi-console extension<br/>(M2, outbound only)"]
  end
  subgraph daemon["daemon · 127.0.0.1 · token"]
    adapters["source adapters<br/>(read-only tailers)"] --> log[("append-only<br/>SQLite event log")]
    log --> proj["projections<br/>(read models)"]
    proj --> api["REST + SSE API<br/>(contract)"]
  end
  files --> adapters
  ext -.-> adapters
  api --> vm["viewmodels"]
  vm --> web["Web UI (React)"]
  vm --> tui["TUI (OpenTUI)"]
  api -.-> mcp["MCP / Direct<br/>(M4)"]
```

Everything is derived from the append-only event log, so every screen can be rebuilt by replay. Packages (`packages/`): `contract` (schemas and shared types), `core` and `adapters` (sources, ingestion, projections), `daemon`, `viewmodels` (what both clients render), `web`, `tui`, `cli`, `testkit` (mock daemon and synthetic fixture). Details: [docs/architecture.md](docs/architecture.md).

## Security model

pi sessions can run shell commands and hold credentials, so the console treats its own surface as hostile territory. The full threat model is in [docs/security.md](docs/security.md) and [ADR-0006](docs/adr/0006-security-model.md).

- **Loopback only.** The daemon binds `127.0.0.1`; a Host allowlist and an Origin check (plus a CSRF header for writes) defend against DNS rebinding and cross-site requests.
- **Token on every request.** A 256-bit random token in an owner-only (0600) file, removed from the URL after exchange, `HttpOnly` cookie, rotation and scoped read-only tokens.
- **Strict CSP.** The web bundle is served with a strict Content-Security-Policy and no external network.
- **Transcripts are untrusted text.** Model and attacker-written content is rendered as text, never HTML; control sequences are stripped in the TUI.
- **Read-only in M1.** No intervention path exists yet; later writes are typed commands with an audit trail.
- **Secrets are redacted** at ingestion (fail closed) and again on return.

## Demo data and regenerating the media

All demo data is synthetic: `npm run generate` rebuilds the fixture used by the media pipeline and demo launcher. `npm run media` regenerates `docs/media/`, including every main web view in midnight and dawn and the [VHS terminal recording](scripts/media/tui.tape). It needs Chromium, `ffmpeg` and `cwebp`; VHS additionally needs `vhs` and `ttyd`. Without VHS, the terminal recording falls back to the existing PTY frame capture and says so. See [docs/media/README.md](docs/media/README.md) for commands, the shot list, budget and determinism notes. Media generation is manual, not part of CI.

## Status

| Milestone | Scope | State |
|---|---|---|
| M0 | Spikes and visual bake-off | Spikes complete; results are in the ADRs |
| M1 | Read-only console (web and TUI) over the daemon | In progress; both UIs, the daemon and the contract exist |
| M2 | Live transcript and interventions | Planned |
| M3 | Remote access and self-host | Planned |
| M4 | MCP server and Direct adapter | Planned |
| M5 | Learning and polish | Planned |

Acceptance criteria per milestone: [docs/milestones.md](docs/milestones.md).

## Documentation

| Document | Content |
|---|---|
| [docs/index.md](docs/index.md) | Table of contents and reading order |
| [docs/vision.md](docs/vision.md) | Problem, vision, principles, personas, non-goals |
| [docs/information-architecture.md](docs/information-architecture.md) | Entities, navigation, status taxonomy, screens, keyboard map, visual style |
| [docs/ui-web.md](docs/ui-web.md) | Running the web console, its keyboard map and security model |
| [docs/ui-tui.md](docs/ui-tui.md) | The terminal UI: keys, structure, tests |
| [docs/event-model.md](docs/event-model.md) | Event catalogue, projections, idempotency, privacy |
| [docs/architecture.md](docs/architecture.md) | Components, process model, packages, data directories, testing |
| [docs/api/v1.md](docs/api/v1.md) | The daemon API |
| [docs/security.md](docs/security.md) | Threat model and controls |
| [docs/milestones.md](docs/milestones.md) | M0 to M5 with acceptance criteria |
| [docs/research-summary.md](docs/research-summary.md) | Research findings with sources |
| [docs/adr/](docs/adr/) | Architecture decision records |
| [docs/media/README.md](docs/media/README.md) | The shot list and how the pictures are generated |

## License

License: to be announced.
