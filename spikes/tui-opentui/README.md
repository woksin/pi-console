# OpenTUI React signature-view spike (M0 round 2)

A real `@opentui/react` terminal client of the existing mock daemon. Synthetic data only. Interventions record audit events: **no command is delivered and no session is changed**. Uses Node, not Bun; do not copy the experimental FFI flags into production without reviewing the runtime/security trade-off.

## Run

Requires Node **26.8+**, npm and a supported OpenTUI native binary. Tested on macOS arm64 with Node 26.8.1. Start from the repository root:

```sh
npm --prefix spikes/tui-opentui ci
node spikes/mock-daemon/server.ts
# In another terminal, at the repository root:
PI_CONSOLE_TOKEN_FILE="$PWD/.pi-console-dev/token" \
  npm --prefix spikes/tui-opentui start -- --colors truecolor
```

The explicit token path matters: `npm --prefix … start` changes the working directory. `PI_CONSOLE_URL` defaults to `http://127.0.0.1:4777`; `PI_CONSOLE_TOKEN_FILE` defaults to `.pi-console-dev/token` relative to the client process. Never commit the token. `--colors 256` and `--colors 16` select terminal-safe palettes. Optional `PI_CONSOLE_REDUCED_MOTION=1` skips entrance/highlight interpolation (message activity still updates).

## Navigation

| Key | Action |
| --- | --- |
| `t` / `g` | Swimlane timeline / communication graph, from any non-modal view |
| `Esc` | Close modal, then clear search, then fleet |
| `Ctrl+P` / `:` | Fuzzy command palette; includes every view and intervention composer |
| `?` / `/` | Help / search; transcript search is local to retained history |
| `j/k`, arrows, click | Select session in fleet/timeline; select node **or edge** in graph |
| `Enter` | Open session; in timeline open at selected signal's timestamp |
| timeline `+/-`, `h/l`, arrows, wheel | Centered zoom, horizontal pan; `n` returns to recorded now |
| timeline `c`, click repository | Collapse / expand selected repository |
| timeline `[` / `]`, click marker | Select previous / next signal with provenance preview |
| graph `[` / `]`, click repository | Switch repository; graph preserves orchestrator → lanes → subagents layers |
| detail `Tab` | Transcript / context focus |
| detail arrows, `PgUp/PgDn`, wheel | Pause and scroll without moving the anchor when SSE arrives |
| detail `Home`, `End`, `f` | Oldest retained history / resume follow |
| detail `[` / `]`, `Enter`, space, click | Move thinking/tool block cursor, disclose **that block** independently |
| `i` | Intervention composer for the selected session |
| composer `Tab` / `Shift+Tab`, click mode | Steer / follow-up / next-turn / abort / answer |
| composer `Enter`, `Ctrl+S`, `Esc` | Newline / validate and submit / cancel |
| `!`, `q`, `Ctrl+C` | Fleet needs-you filter / quit / quit |

Abort requires typing the lane ID. Answer binds to the selected session's first open question. Target repository, lane, status and last request are always shown. The composer keeps the same target while open, blocks duplicate submissions, reports validation/HTTP errors, distinguishes HTTP 202 from `intervention.recorded` SSE, and explicitly labels the result as audit-only. When an edge is selected, `i` uses the last selected node, not an inferred conversation participant; inspect the target header before submitting.

## Signature views and motion

- Swimlanes are grouped by repository, with two-line session rows, ticked time grid, recorded-now cursor, selectable request/answer/interruption/reset/question/message markers and a provenance/detail panel. `Enter` backfills the transcript and pauses at the nearest retained entry to that signal.
- The graph uses positioned terminal boxes plus a cell raster of routed links, not an adjacency list. Nodes show lane/status; links show message volume through brightness and counts. SSE `message.sent` updates produce moving packets and a 1.5-second edge glow. Node/edge selection opens a scrollable recent-message/conversation pane.
- OpenTUI's own `createTimeline` + `easings.outCubic` drive view/header and composer entrance. The composer has a damped overshoot; fleet selection, SSE status changes and selected transcript blocks interpolate their highlight. The graph pulse clock only runs while the graph is mounted. Cleanup unregisters timelines from the captured renderer engine.
- No browser/webview or Ink compatibility renderer. The bounded store batches SSE notifications to ~30 Hz, de-duplicates cursors, caps each transcript at 2,500 entries; tool bodies are projected only when expanded. Audit storage is capped at 100 interventions. Follow-off uses a frozen projection with an unread count.

## Media

The [33.56-second tour](signature-tour.gif) is an actual VHS PTY recording: timeline zoom/pan/collapse/marker opening, tool disclosure, graph selection and multiline intervention submission with streamed acknowledgement. Captures were visually inspected; no token is visible.

| View | 120×40 | 200×60 |
| --- | --- | --- |
| Timeline | [PNG](timeline-120.png) | [PNG](timeline-200.png) |
| Graph | [PNG](graph-120.png) | [PNG](graph-200.png) |
| Composer | [PNG](composer-120.png) | [PNG](composer-200.png) |

Also: [selected edge](edge-120.png), [HTTP + SSE acknowledgement](recorded-120.png), [installed-package launch](distribution-120.png). [Original round-one fleet/detail media](demo.gif) remain available as baseline, not round-two evidence.

Regenerate from the repository root (VHS/ttyd/ffmpeg and Menlo required):

```sh
vhs spikes/tui-opentui/demo.tape
vhs spikes/tui-opentui/capture-wide.tape
node spikes/tui-opentui/benchmark.mjs
```

The capture tapes write only disposable logs/sizing to ignored `.ai-work/`; committed PNG/GIF files are task deliverables. `stty size` verified 40×120 and 60×200.

## Packaged distribution (no source checkout dependencies)

This is a tarball-installable **npm CLI**, not a standalone binary and not an `npm start` alias. The executable launcher checks Node/platform, resolves its own production `tsx` loader, ships/explicitly selects its JSX tsconfig, then spawns Node with experimental FFI. The package excludes tests. Production installation retains React, OpenTUI, tsx and the appropriate optional native OpenTUI package; a developer TypeScript installation is not needed to launch.

```sh
# From repository root; use a fresh install prefix for the proof.
mkdir -p .ai-work/opentui-r2-dist
(cd spikes/tui-opentui && npm pack --pack-destination ../../.ai-work/opentui-r2-dist)
npm install --prefix "$PWD/.ai-work/opentui-r2-dist/install-final" --omit=dev \
  "$PWD/.ai-work/opentui-r2-dist/pi-console-tui-opentui-0.0.2.tgz"
.ai-work/opentui-r2-dist/install-final/node_modules/.bin/pi-console-opentui --version
# With mock daemon running, at repository root:
.ai-work/opentui-r2-dist/install-final/node_modules/.bin/pi-console-opentui --colors truecolor
# Or capture the installed executable (starts its own mock daemon):
vhs spikes/tui-opentui/distribution.tape
```

Only macOS arm64 was installed/launched here. Upstream 0.9.6 publishes native packages for macOS/Linux/Windows x64 and arm64 (plus Linux musl); these are **not locally verified**. Unsupported OS/architecture and older Node versions fail with explicit launcher errors. The tarball is small because native binaries arrive as npm dependencies, not because this is a single-file application. FFI is an experimental runtime prerequisite, not hidden bundling magic.

## Checks and limits

Measured animation/load results and exact whole-repository gate outcomes: [OpenTUI round-two report](../../docs/spikes/tui-bake-off-opentui.md).

```sh
cd spikes/tui-opentui
npm run check          # strict TypeScript, no emit
npm test               # native renderer + projection/validation tests
npm run test:integration # real authenticated mock HTTP/SSE, reconnect, five intervention modes
```

Native tests cover zoom/pan bounds, marker provenance, graph selection/volume/pulse projection, independent disclosure, modal navigation, multiline text, HTTP/SSE success, abort validation, transport error, cancellation and narrow stacking, in addition to baseline search/follow/bounding/mouse/resize tests. React test mode emits some non-failing `act` warnings from real animation ticks. Integration also verifies bad abort confirmation is rejected. Root fixture/mock tests are separate (`npm test` at root).

Known partials/trade-offs:

- One repository's five-node layered graph is shown at a time; there is no cross-repository routing/layout engine. Sparse cell routing can share segments, and generic future hierarchies need a proper graph-layout pass.
- The timeline uses recorded fixture/SSE timestamps, not wall-clock session state intervals. Static fixture markers have incomplete start/end coverage. Selecting a signal jumps to the nearest **retained** entry, not an unavailable exact event cursor; thinking/tool entries are independently navigated in detail rather than all drawn as timeline glyphs.
- At <100 columns graph/context panes stack; at very short heights the conversation viewport is small. Native test exercises 90×30; 120×40 is the recommended minimum for the full composition. Very narrow mode-tab/repository strips can clip rather than wrap.
- Palette options are generated from existing view/session state. Search is bounded in-memory, not a daemon-wide query. No clipboard, OS notifications, live adapter delivery or durable intervention status tracking.
- CPU measurements include native rendering/FFI and experimental runtime overhead. Render cadence is sampled from `renderer.getStats().frameCount`, distinct from store notification cadence. Synthetic load is not a long soak test.
- No repository CI workflow or lint/format script exists here. Tier 1 attempted the root syntax check, native strict typecheck, all existing test suites and `git diff --check`; the root syntax check fails on the existing `spikes/arc-ts/client/generated/All.ts:16` TypeScript parameter property (`constructor(readonly query: All)` is unsupported in Node strip-only mode). This unrelated generated source/checker was not modified. Thus **no fully green CI-equivalent whole-repository gate is claimed**.

## Code Health

CodeScene review + final score were run on changed source/launcher/benchmark/tests. Before = round-one branch files; new = added in this round, including the resumed unfinished slice. One behavior-preserving extraction pass raised the existing low-score UI files and kept the store at 10. Scores below 9.5 remain explicit uplift exceptions; no issue was opened by this subagent.

| File (under this directory) | Before | After |
| --- | ---: | ---: |
| `src/app.tsx` | 8.40 | 8.49 |
| `src/transcript.tsx` | 8.10 | 8.34 |
| `src/model.ts` | 10 | 10 |
| `src/client.ts` | 10 | 10 |
| `src/fleet.tsx` | 10 | 10 |
| `src/main.tsx` | 10 | 10 |
| `src/metrics.ts` | 10 | 10 |
| `src/client.integration.tsx` | 10 | 10 |
| `benchmark.mjs` | 10 | 10 |
| `src/swimlane.tsx` | new | 10 |
| `src/motion.ts` | new | 10 |
| `src/graph.tsx` | new | 8.70 |
| `src/composer.tsx` | new | 9.05 |
| `src/signature-model.ts` | new | 8.45 |
| `src/signature.test.tsx` | new | 10 |
| `src/composer.test.tsx` | new | 10 |
| `bin/pi-console-opentui.mjs` | new | 10 |

Uplift follow-up: app/transcript still combine view state, keyboard handlers and projection; graph/composer combine control and rendering; signature-model retains branching provenance/validation helpers and the positional intervention API. Larger controller/component/API separation was not safe to expand into in this bounded visual spike. Config, Markdown and VHS tape files are not scored source languages.
