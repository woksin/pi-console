# ADR-0003: TUI stack, decided by a visual bake-off in M0

- Status: Accepted (OpenTUI). Decided by the M0 visual bake-off and delegated to the orchestrator by the owner (Q-378).
- Date: 2026-11-20
- Supersedes: an earlier draft of this ADR that preselected pi-tui. That draft weighted ecosystem fit first; the owner's priority order is different (below).

## Context

The TUI is a primary front end ([vision](../vision.md)). The owner's top priority for it is that it looks impressive and has excellent UX with rich, purpose-built views (the signature views in [information-architecture.md](../information-architecture.md): live communication graph, swimlane timeline, inline-answer inbox, intervention composer, palette, runners panel). Fit with the pi and TypeScript ecosystem is second.

Criteria, in priority order:

1. **Visual quality**: true colour and gradients, charts (braille and block), borders, typography within the cell grid, theming.
2. **UX and interaction quality**: animation, smooth streaming of transcripts, mouse, overlays, layout (split panes, virtual lists), keyboard model.
3. Testability, distribution, maintenance, cross-platform, fit with pi and TypeScript sharing.

Facts from the research ([R2], [R6]; versions differ between the two reports, see "Unresolved" below):

| Option | Language and runtime | Visual and UX ceiling | Notes |
|---|---|---|---|
| OpenTUI (React or Solid renderers) | TypeScript on a Zig native core; Bun >= 1.3.14, or Node >= 26.4 with FFI | Highest in the TypeScript field: flexbox layout, built for streaming coding-agent UIs, used in production by opencode | Pre-1.0 and fast-moving; the migration from Bubble Tea caused regressions in opencode (reported in an opencode issue; a TUI rewrite, not a backend rewrite). Native per-platform packages, not a single static binary. Testing support UNVERIFIED |
| Bubble Tea v2 + Lip Gloss v2 (+ Bubbles) | Go, single static binary | Charm polish: stable v2 (announced Feb 2026), advanced compositing, declarative API | opencode left it for performance and capability reasons. No TypeScript sharing. Homebrew and single binary are easy |
| Ratatui | Rust, single binary | Strong, immediate-mode, widely used (Codex CLI) | Codex needs unstable Ratatui features for its TUI (secondary source). Highest implementation effort |
| pi-tui (`@earendil-works/pi-tui`) | TypeScript, Node >= 22.19 | Alt-screen layout, scroll views, markdown, mouse, OSC 52, synchronized output, OKLab/OKLCH colour utilities | Best fit with pi; no tabs, table, tree, list virtualisation or charts; text-line renderer; lowest widget set |
| Ink 8 | TypeScript, React | Plainer; weaker scroll, mouse and full-screen behaviour | `@inkjs/ui` unmaintained since 2024 |
| Textual, Terminal.Gui, blessed | Python, .NET, JS | Not competitive for this brief | blessed unmaintained |

R2's weighted score put pi-tui first (73) and OpenTUI second (72) with ecosystem fit weighted heavily; R2 notes the ranking is sensitive to that one criterion. With visual and UX quality weighted first, the order is not settled by the research.

## Options

1. Preselect pi-tui (earlier draft). Lowest risk and best pi fit; lowest visual ceiling and the most widgets to build.
2. Preselect OpenTUI. Highest TypeScript visual ceiling; pre-1.0 and Bun or Node 26 runtime.
3. Preselect Bubble Tea v2 or Ratatui. Polish and single binary; separate language and no code sharing.
4. **Do not preselect: run a time-boxed visual bake-off in M0 and decide on evidence.**

## Decision

Option 4. The M0 bake-off is finished and this ADR is now **Accepted: OpenTUI** (React renderer). The owner delegated the decision to the orchestrator (Q-378), who ranked by the criteria below on the recorded evidence: round one ([bake-off](../spikes/tui-bake-off.md)) and OpenTUI round two ([OpenTUI](../spikes/tui-bake-off-opentui.md)), with Bubble Tea v2 round two ([Bubble Tea](../spikes/tui-bubbletea-r2.md)) as the comparison.

- **Pinned version:** `@opentui/core` and `@opentui/react` **0.9.6**, exact, isolated behind an adapter layer in `packages/tui`. Runtime: Node >= 26.8 with `--experimental-ffi` (the Node floor for M1 is 26).
- **Fallback:** Bubble Tea v2 + Lip Gloss v2 (Go, single binary). It stays viable because the TUI is only an API client; it is used if OpenTUI fails the first-release gate below.
- **First-release gate:** a Linux install plus a runtime interaction test (native binary loads, views render, keys work, resize works) must pass before the first release; macOS is verified in M1. The FFI and native binary acceptance is recorded in [security](../security.md#native-code-in-the-tui-ffi).

The bake-off protocol that produced this decision:

Bake-off protocol (details in [milestones.md](../milestones.md#m0-spikes)):

- Candidates: OpenTUI (React renderer), Bubble Tea v2 + Lip Gloss v2, and pi-tui as the pi-fit baseline. Ratatui joins only if the first two results are inconclusive (it has the highest cost per screen).
- The same two screens in each stack: **fleet overview** and **session detail with a live streaming transcript**, driven by **recorded fixture data** (a replayable event stream, so every stack renders identical content), including a reset marker, an interrupted request, a context-pressure sparkline and a status-colour gradient.
- Compare screenshots and screen recordings side by side; also record frame time and CPU while streaming 5,000 lines per second of synthetic transcript, resize behaviour, mouse and overlay behaviour (a command palette over the screen), and 16-colour and 256-colour degrade.
- Scoring uses the criteria above in order; the owner reviews screenshots and recordings. A stack that cannot deliver the signature views (graph canvas, swimlane timeline) at acceptable quality is out.
- Ranking is lexicographic: visual quality decides first; ties go to UX and interaction quality (animation, streaming, mouse, overlays, layout); only if still tied do testability, distribution, maintenance and pi and TypeScript fit decide, in that order.

Fixed regardless of the winner:

- **The TUI is a client of the daemon API.** It talks to the daemon over the same HTTP and SSE contract as the web UI and holds no business logic and no database access. The choice of language is therefore decoupled from the backend ([ADR-0002](0002-web-stack-node-arc-typescript-react.md)).
- **A non-TypeScript TUI (Go or Rust) needs a client.** The daemon publishes a machine-readable contract (OpenAPI document and SSE event schema; whether Arc for TypeScript emits OpenAPI is UNVERIFIED, otherwise the contract is hand-written as JSON Schema) from which the client is generated, or a small hand-written client for the few endpoints the TUI uses (list, get, stream, commands). The contract has a conformance test run against the daemon.
- **Theme and status tokens are shared data** (token to colour), consumed by web and every TUI candidate.
- A pi extension panel (status line, Q&A overlay inside pi) is **only** built from shared components if the winner is TypeScript on pi-tui. Otherwise the extension stays minimal: a status line and a command that launches the console ([ADR-0005](0005-live-session-integration-via-pi-extension.md)); it does not embed a second renderer in pi ([R2 §1]).

## Consequences

- M0 gains a visual bake-off (about one to two weeks for three stacks, UNVERIFIED estimate) before M1 TUI work starts; M1's daemon, ingestion and web work do not wait for it.
- The daemon API contract must be specified early and kept stable enough that two or three throwaway TUIs can be built against it. This also benefits the web UI and MCP.
- If a Go or Rust stack wins, distribution is a single binary (Homebrew, release assets) separate from the npm package, and the pi extension cannot reuse TUI components.
- If OpenTUI wins, the TUI requires Bun or Node >= 26.4; the CLI must detect the runtime and explain the requirement, and compiled distribution (for example `bun build --compile`, UNVERIFIED for this use) is evaluated.
- If pi-tui wins, the widget gaps (tabs, table, tree, virtual list, charts) are built in a `ui/kit` layer.
- Pin the winner's version exactly and isolate it behind an adapter layer, whichever it is.

## Unresolved

- Version facts conflict between research reports: Ink is 8.0.0 on the registry per R2 but R6 cites a v7.0.0 release (2026-04-08); `@opentui/core` is 0.9.6 per R2 and 0.9.2 per R6; R2 reports pi-tui 1.5.2 while R4 and R5 cite pi 0.85.1. Re-check at bake-off start.
- OpenTUI test support and compiled-binary distribution are UNVERIFIED.
- The pi-tui `VirtualTerminal` test helper is not in the published package [R2 §1]; a test terminal on `@xterm/headless` is needed.
