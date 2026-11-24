<div align="center">

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/media/hero-light.webp">
  <img src="docs/media/hero-dark.webp" alt="pi-console web Overview with a Needs you inbox, fleet status and context pressure, alongside the terminal UI" width="900">
</picture>

**A persistent, keyboard-first console for a local [pi](https://github.com/earendil-works/pi) setup.**<br>
Follow sessions, requests, questions and messages in a web UI or terminal UI over the same event-sourced store.

[![CI](https://github.com/woksin/pi-console/actions/workflows/ci.yml/badge.svg)](https://github.com/woksin/pi-console/actions/workflows/ci.yml)
![Node 26+](https://img.shields.io/badge/node-%E2%89%A5%2026-3c873a)
[![Read-only by default](https://img.shields.io/badge/access-read--only%20by%20default-66d9ef)](#security-model)

Read-only by default; opt-in memory review requests require human confirmation in pi.

[Quick start](#quick-start) · [Tour](#tour) · [Gallery](#gallery) · [Architecture](#architecture) · [Docs](#documentation)

</div>

## What you get

- **One place for every pi session**: see what is running, what is stale, and what needs you, grouped by reason.
- **Web and terminal clients with the same views**: Overview, Fleet, Requests, Questions, Messages, Timeline and more, over one daemon.
- **Transcripts with reset markers and memory review**: follow what was asked across context resets, and request memory changes that you confirm in pi.
- **Keyboard-first**: a command palette (`Ctrl+P`) and single-key view switching in both clients.
- **Local-only and token-protected**: the daemon binds to loopback, requires a token, and is read-only by default.

## Quick start

Install **Node.js 26 or newer** and Git, then run:

```sh
git clone https://github.com/woksin/pi-console.git && cd pi-console
npm ci
npm run console -- --open
```

**This demo serves sample data, not your sessions.** To watch real sessions, build the web client, then start the live-data daemon: `npm run build -w @pi-console/web`, then `node packages/cli/bin/pi-console.mjs daemon --web-dist packages/web/dist` (details below).

The launcher prints a one-click login link and opens it in your browser (best effort; omit `--open` to just print the link). You'll see the gallery's sample fleet with recent activity, costs, memory, mixed statuses, and sample requests, questions and transcripts. Live samples run for 15 minutes with a fixed event budget. For the terminal demo, use `npm run console -- --tui` instead. The launcher builds the web client and starts an isolated demo daemon; it reads no local pi data. **Ctrl-C** stops it and removes its temporary data and token.

<table>
<tr>
<td><a href="docs/media/web-connect.webp"><img src="docs/media/web-connect.webp" width="280" alt="Midnight connection screen with an access-token field and Connect button"></a><br>Connect to the daemon</td>
<td><a href="docs/media/web-first-run.webp"><img src="docs/media/web-first-run.webp" width="280" alt="Midnight Overview with no sessions and a getting-started checklist"></a><br>First run with no source data (not the populated demo)</td>
</tr>
</table>

<details>
<summary>Demo, real data and the terminal client</summary>

`npm run console` and `npm run demo` use the same launcher. It serves the gallery's fixture-backed mock daemon with a bounded live stream; each run starts fresh on a free loopback port. Use `npm run console -- --tui` for a terminal demo. `npm start` is the developer mock, not the live-data daemon.

To use your own pi data, run these from the checkout:

```sh
npm run build -w @pi-console/web
node packages/cli/bin/pi-console.mjs daemon --web-dist packages/web/dist
```

Open the printed launch link. The daemon reads `~/.pi/agent` by default and keeps its own store in `~/.pi-console`; it does not modify the source files. For a terminal client, open a second terminal in the checkout:

```sh
node packages/cli/bin/pi-console.mjs tui
```

The web and terminal clients share the same daemon. There is no global install yet. See the [web guide](docs/ui-web.md) and [TUI guide](docs/ui-tui.md) for controls and platform notes.

</details>

<details>
<summary>Tokens, configuration and connection troubleshooting</summary>

- **Web authentication:** the live daemon's launch link carries the token in `#token=`, a URL fragment that never reaches the server. The client removes it from the address bar. You can instead paste the contents of `<data-dir>/token`. The demo uses the same fragment login flow with a throwaway loopback token. With `--open`, that URL is passed to the browser opener and may be visible in local process arguments.
- **Data directory:** `--data-dir` overrides `PI_CONSOLE_DATA_DIR`, then defaults to `~/.pi-console`. The daemon reads `config.json` there on startup; restart after changing it.
- **Port:** the live daemon defaults to `4777`. For a one-off port, use `daemon --port 5888 --web-dist packages/web/dist`, then `tui --url http://127.0.0.1:5888` with the CLI above. The TUI resolves its URL from `--url`, `PI_CONSOLE_URL`, the data directory's configured port, then `http://127.0.0.1:4777`. Use the same `--data-dir` for both clients when changing it.
- **API-only message:** build the web client and pass `--web-dist packages/web/dist`. A missing bundle or `index.html` means the daemon serves only the API and prints no launch link.
- **Missing sources:** startup diagnostics and Settings identify unavailable source directories. Use `--agent-root <path>` if pi lives elsewhere. The daemon does not create source directories; ingestion picks them up when they become available.
- **Errors:** the CLI prints a short error and exits non-zero. Set `PI_CONSOLE_DEBUG=1` for a stack trace; do not share tokens or private session data in diagnostics.

List all supported flags without starting a daemon or opening the TUI:

```sh
node packages/cli/bin/pi-console.mjs --help
node packages/cli/bin/pi-console.mjs daemon --help
node packages/cli/bin/pi-console.mjs tui --help
```

</details>

<a id="optional-pi-extension-and-memory-review"></a>
<details>
<summary>Optional pi extension and memory review</summary>

The console can read pi session logs without an extension. The extension adds an outbound connection for **memory review requests**, not general remote control.

1. Merge `"memoryActions": true` into the daemon's `<data-dir>/config.json`, preserving other keys, then restart it. This creates a separate `<data-dir>/memory-control-token`.
2. Load `packages/extension` as a pi extension. Its package manifest declares `./src/index.ts` under `pi.extensions`.
3. Set `PI_CONSOLE_MEMORY_REVIEW=1` in pi's environment. For non-default connections, also set `PI_CONSOLE_URL` and/or `PI_CONSOLE_DATA_DIR`.
4. Connect a compatible, ready interactive pi memory provider and use the separate memory-control credential in the console. See [web memory review](docs/ui-web.md#memory-review) or [TUI memory review](docs/ui-tui.md#memory-review) for credential setup.

**Confirm…** / **Reject…** request native human confirmation in the owning pi session. The console never writes memory directly, and waits for canonical producer ingestion to show the change. The ordinary token stays read-only. When review is unavailable, the UI shows the exact command to run in pi and a reason. Answering, steering and pausing are not available.

</details>

## Tour

> The name `pi-console` is provisional. All images below use sample data, not live sessions.

Long-running work spreads across sessions, lanes and file stores. Context resets make it harder to follow what was asked and what still needs an answer. pi-console brings those records together without treating uncertain or missing history as complete. See [request coverage and limitations](docs/requests.md).

### Needs you first

Overview groups attention by reason: blocking questions, open requests, possibly unseen answers, lanes waiting on you, proposed memory, then stale sessions. Each section has a count and shows the newest items first. Human replies take priority over lane and memory actions, with passive staleness last. Web and TUI share this order. The fleet pulse and context-pressure histogram sit alongside them. Fleet, Requests, Questions, Messages, Timeline and Work are one keypress away.

Status glyphs carry meaning even without colour:

| Status | Glyph |
|---|---|
| Needs you | `!` |
| Blocked | `×` |
| Failed | `#` |
| Possibly unseen | `¿` |
| Stale | `?` |

Failed uses ASCII `#` to stay clearly distinct from blocked `×` in monospace fonts. Possibly unseen uses `¿` because `?` already means stale; its chip reads “Possibly unseen”, never “Unanswered”.

<img src="docs/media/web-tour.gif" alt="Web keyboard tour moving from Overview to Fleet, a session reset divider and the Timeline" width="900">

### Follow live updates

A session finishes in Fleet, then a new blocking question raises the **Needs you** count and adds a session chip on Overview. Updates arrive through live ingestion without a page reload.

<img src="docs/media/web-live-fleet.gif" alt="Midnight Fleet marking a session Done, then Overview showing a higher Needs you count and a new session chip" width="900">

### Find a session without leaving the keyboard

`Ctrl+P` or `:` opens the command palette. Prefixes narrow the search: `>` commands, `@` sessions and lanes, `#` questions and requests, `/` messages. Use `1`–`7` to switch views, `j`/`k` to move, `Enter` to open, `Esc` to go back and `?` for help (see the [gallery](#gallery)).

<img src="docs/media/web-palette.gif" alt="Command palette filtering sessions, lanes and questions, then opening the selected session" width="900">

### Review memory with confirmation in pi

A **Confirm…** request moves through awaiting native human confirmation in pi, then awaiting canonical producer ingestion. Only the ingested change makes the proposed item active. The console does not confirm or write memory itself. See the [optional extension setup](#optional-pi-extension-and-memory-review) above.

<img src="docs/media/web-memory-review.gif" alt="Midnight memory review moving from a request through awaiting confirmation in pi and producer ingestion to an active item" width="900">

### The same data in your terminal

The [OpenTUI](https://github.com/anomalyco/opentui) client uses the same API, view models and status semantics. It includes question history, transcript reset dividers, memory review requests and a full-width Memory view (`m` in a session).

A [VHS tape](scripts/media/tui.tape) records the terminal client against the isolated demo daemon. An animated keyboard tour is in the [TUI guide](docs/ui-tui.md).

<img src="docs/media/tui-vhs.gif" alt="Terminal recording showing Overview, Fleet, Requests and Settings with sample data" width="880">

## Gallery

Click any thumbnail for the full-size image. The web client offers midnight (default), dawn and high contrast in Settings. Status uses glyphs as well as colour. The TUI supports midnight, contrast and mono (`PI_CONSOLE_THEME=mono`); `NO_COLOR=1` selects plain output with no colour codes.

### Web · midnight

<table>
<tr>
<td><a href="docs/media/web-overview.webp"><img src="docs/media/web-overview.webp" width="280" alt="Midnight Overview with Needs you inbox and fleet pressure"></a><br>Overview</td>
<td><a href="docs/media/web-fleet.webp"><img src="docs/media/web-fleet.webp" width="280" alt="Midnight Fleet grouped by repository with context bars"></a><br>Fleet</td>
<td><a href="docs/media/web-requests.webp"><img src="docs/media/web-requests.webp" width="280" alt="Midnight Requests with state, origin and session filters"></a><br>Requests</td>
</tr>
<tr>
<td><a href="docs/media/web-questions.webp"><img src="docs/media/web-questions.webp" width="280" alt="Midnight Questions with history, sorting and a stale marker"></a><br>Questions and history</td>
<td><a href="docs/media/web-messages.webp"><img src="docs/media/web-messages.webp" width="280" alt="Midnight Messages list showing lane communications"></a><br>Messages</td>
<td><a href="docs/media/web-graph.webp"><img src="docs/media/web-graph.webp" width="280" alt="Midnight lane communication graph"></a><br>Lane communication graph</td>
</tr>
<tr>
<td><a href="docs/media/web-timeline.webp"><img src="docs/media/web-timeline.webp" width="280" alt="Midnight Timeline with request, answer and reset markers"></a><br>Timeline</td>
<td><a href="docs/media/web-work.webp"><img src="docs/media/web-work.webp" width="280" alt="Midnight Work view of jobs and phase activity"></a><br>Work</td>
<td><a href="docs/media/web-session.webp"><img src="docs/media/web-session.webp" width="280" alt="Midnight session transcript and memory review controls"></a><br>Session and memory review</td>
</tr>
<tr>
<td><a href="docs/media/web-attention-retry.webp"><img src="docs/media/web-attention-retry.webp" width="280" alt="Midnight Overview reporting unavailable attention with Retry"></a><br>Unavailable, not all clear</td>
<td><a href="docs/media/web-settings.webp"><img src="docs/media/web-settings.webp" width="280" alt="Midnight Settings with source health and theme preferences"></a><br>Settings</td>
<td><a href="docs/media/web-session-resets.webp"><img src="docs/media/web-session-resets.webp" width="280" alt="Transcript reset divider listing carried and interrupted requests"></a><br>Context resets</td>
</tr>
<tr>
<td><a href="docs/media/web-pulse.webp"><img src="docs/media/web-pulse.webp" width="280" alt="Fleet pulse status counts and context-pressure histogram"></a><br>Fleet pulse</td>
<td><a href="docs/media/web-transcript-history.webp"><img src="docs/media/web-transcript-history.webp" width="280" alt="Midnight session transcript paused on older entries with a Return to live action"></a><br>Transcript history</td>
<td><a href="docs/media/web-timeline-history.webp"><img src="docs/media/web-timeline-history.webp" width="280" alt="Midnight Timeline with loaded and total counts and a Load older messages control"></a><br>Timeline history</td>
</tr>
<tr>
<td><a href="docs/media/web-help.webp"><img src="docs/media/web-help.webp" width="280" alt="Midnight keyboard help overlay listing the shortcuts"></a><br>Keyboard help (<code>?</code>)</td>
<td><a href="docs/media/web-offline.webp"><img src="docs/media/web-offline.webp" width="280" alt="Midnight Fleet kept on screen under a Disconnected banner after the daemon stopped"></a><br>Daemon unreachable, data kept</td>
<td><a href="docs/media/web-themes.webp"><img src="docs/media/web-themes.webp" width="280" alt="Settings preview cards for midnight, dawn and high contrast"></a><br>Theme previews</td>
</tr>
</table>

### TUI

<table>
<tr>
<td><a href="docs/media/tui-overview.webp"><img src="docs/media/tui-overview.webp" width="280" alt="Terminal Overview with Needs you inbox and fleet status bars"></a><br>Overview</td>
<td><a href="docs/media/tui-palette.webp"><img src="docs/media/tui-palette.webp" width="280" alt="Terminal command palette with matching sessions and questions"></a><br>Command palette</td>
<td><a href="docs/media/tui-session-resets.webp"><img src="docs/media/tui-session-resets.webp" width="280" alt="Terminal transcript filtered to a handoff reset divider"></a><br>Context resets</td>
</tr>
<tr>
<td><a href="docs/media/tui-questions.webp"><img src="docs/media/tui-questions.webp" width="280" alt="Terminal Questions list with sorting and stale status"></a><br>Questions</td>
<td><a href="docs/media/tui-memory-paging.webp"><img src="docs/media/tui-memory-paging.webp" width="280" alt="Terminal Memory view with paging progress for older items"></a><br>Memory history</td>
<td><a href="docs/media/tui-memory-review.webp"><img src="docs/media/tui-memory-review.webp" width="280" alt="Terminal memory proposal with native pi review commands"></a><br>Memory review</td>
</tr>
<tr>
<td><a href="docs/media/tui-attention-retry.webp"><img src="docs/media/tui-attention-retry.webp" width="280" alt="Terminal attention unavailable state with a retry hint"></a><br>Attention retry</td>
<td><a href="docs/media/tui-settings-scroll.webp"><img src="docs/media/tui-settings-scroll.webp" width="280" alt="Terminal Settings scrolled to fit a short viewport"></a><br>Scrollable Settings</td>
<td><a href="docs/media/tui-mono.webp"><img src="docs/media/tui-mono.webp" width="280" alt="Terminal Fleet in mono using glyphs instead of colour"></a><br>Mono theme</td>
</tr>
<tr>
<td><a href="docs/media/tui-question-expanded.webp"><img src="docs/media/tui-question-expanded.webp" width="280" alt="Terminal expanded question with wrapped text, options and recorded history"></a><br>Expanded question</td>
<td><a href="docs/media/tui-requests.webp"><img src="docs/media/tui-requests.webp" width="280" alt="Terminal Requests list showing the origin of each request"></a><br>Request origins</td>
<td><a href="docs/media/tui-tour.gif"><img src="docs/media/tui-tour.gif" width="280" alt="Terminal tour of Overview, Fleet, a session, the command palette and Timeline"></a><br>Tour (animated)</td>
</tr>
</table>

<details><summary>Dawn theme</summary>

<table>
<tr>
<td><a href="docs/media/web-overview-light.webp"><img src="docs/media/web-overview-light.webp" width="280" alt="Dawn Overview with Needs you inbox and fleet pressure"></a><br>Overview</td>
<td><a href="docs/media/web-fleet-light.webp"><img src="docs/media/web-fleet-light.webp" width="280" alt="Dawn Fleet grouped by repository with context bars"></a><br>Fleet</td>
<td><a href="docs/media/web-requests-light.webp"><img src="docs/media/web-requests-light.webp" width="280" alt="Dawn Requests with state, origin and session filters"></a><br>Requests</td>
</tr>
<tr>
<td><a href="docs/media/web-questions-light.webp"><img src="docs/media/web-questions-light.webp" width="280" alt="Dawn Questions with history and a text-labelled stale marker"></a><br>Questions and history</td>
<td><a href="docs/media/web-messages-light.webp"><img src="docs/media/web-messages-light.webp" width="280" alt="Dawn Messages list showing lane communications"></a><br>Messages</td>
<td><a href="docs/media/web-graph-light.webp"><img src="docs/media/web-graph-light.webp" width="280" alt="Dawn lane communication graph"></a><br>Lane communication graph</td>
</tr>
<tr>
<td><a href="docs/media/web-timeline-light.webp"><img src="docs/media/web-timeline-light.webp" width="280" alt="Dawn Timeline with request, answer and reset markers"></a><br>Timeline</td>
<td><a href="docs/media/web-work-light.webp"><img src="docs/media/web-work-light.webp" width="280" alt="Dawn Work view of jobs and phase activity"></a><br>Work</td>
<td><a href="docs/media/web-session-light.webp"><img src="docs/media/web-session-light.webp" width="280" alt="Dawn session transcript beside memory review controls"></a><br>Session and memory review</td>
</tr>
<tr>
<td><a href="docs/media/web-attention-retry-light.webp"><img src="docs/media/web-attention-retry-light.webp" width="280" alt="Dawn Overview reporting unavailable attention with Retry"></a><br>Unavailable, not all clear</td>
<td><a href="docs/media/web-settings-light.webp"><img src="docs/media/web-settings-light.webp" width="280" alt="Dawn Settings with source health and theme preferences"></a><br>Settings</td>
<td><a href="docs/media/web-session-resets-light.webp"><img src="docs/media/web-session-resets-light.webp" width="280" alt="Dawn transcript reset divider with carried and interrupted requests"></a><br>Context resets</td>
</tr>
</table>

</details>

## Architecture

```mermaid
flowchart LR
  subgraph pi["pi, on your machine"]
    files["session JSONL, lanes, messages,<br/>questions, jobs, ledgers"]
    ext["pi-console extension<br/>outbound memory-review connection"]
    human["native human confirmation"]
  end
  subgraph daemon["daemon · 127.0.0.1 · token"]
    adapters["source adapters<br/>(read-only tailers)"] --> log[("append-only<br/>SQLite event log")]
    log --> proj["projections<br/>(read models)"]
    proj --> api["REST + SSE API"]
    review["opt-in memory review<br/>separate control credential"]
  end
  files --> adapters
  ext <-->|"review requests and receipts"| review
  ext --> human
  api --> vm["shared viewmodels"]
  vm --> web["Web UI (React)"]
  vm --> tui["TUI (OpenTUI)"]
  web -.->|"request only"| review
  tui -.->|"request only"| review
```

The append-only event log feeds replayable read models. The extension initiates its connection outbound; the daemon can send review requests over that connection only when enabled. Human confirmation stays in pi, and memory changes arrive through source ingestion. See [architecture](docs/architecture.md), the [event model](docs/event-model.md) and the [API contract](docs/api/v1.md).

## Security model

- **Local only:** the daemon binds `127.0.0.1`, validates Host and Origin, and refuses cross-site requests.
- **Authenticated API:** an owner-only token file supplies the bearer credential. Web credentials stay in tab-scoped `sessionStorage`, not cookies or `localStorage`. Do not share launch links or token files.
- **Read-only by default:** the ordinary token cannot request memory review. Review needs explicit daemon enablement, a separate credential and native human confirmation. There is no direct console memory write or general intervention API.
- **Untrusted content:** transcripts render as text, with terminal control sequences stripped. The web bundle uses a strict Content-Security-Policy.
- **Redaction:** ingestion and API output apply secret redaction. Treat the local store and diagnostics as sensitive regardless.

See the [threat model](docs/security.md) and [security policy](SECURITY.md) for limitations and private vulnerability reporting.

## Demo data and regenerating the media

`npm run generate` rebuilds the sample fixture. `npm run media` regenerates the gallery; it needs Chromium, `ffmpeg` and `cwebp`. VHS recording also needs `vhs` and `ttyd`; otherwise the runner reports a PTY-capture fallback. Media generation is manual, not part of CI. See the [media guide](docs/media/README.md) for individual captures, budgets and determinism notes.

## Status

Web and TUI clients, filesystem ingestion and opt-in memory review are implemented. [M1 acceptance](docs/m1-acceptance.md) records the verified scope and retained request/view coverage limitations. The [milestone plan](docs/milestones.md) includes future general interventions, remote access and MCP/Direct integration; those are not current capabilities.

## Documentation

| Start here | What you'll find |
|---|---|
| [Documentation index](docs/index.md) | Reading order and design references |
| [Web guide](docs/ui-web.md) · [TUI guide](docs/ui-tui.md) | Running each client, keyboard maps and memory review |
| [Requests](docs/requests.md) | Pairing, provenance and coverage limitations |
| [Architecture](docs/architecture.md) · [Event model](docs/event-model.md) · [API](docs/api/v1.md) | Components, ingestion, projections and contracts |
| [Security](docs/security.md) · [SECURITY.md](SECURITY.md) | Threat model and vulnerability reporting |
| [Vision](docs/vision.md) · [Milestones](docs/milestones.md) · [ADRs](docs/adr/) | Product direction and design decisions |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, checks and release notes |
| [Media guide](docs/media/README.md) | Synthetic captures and regeneration |

## License

[MIT](LICENSE).
