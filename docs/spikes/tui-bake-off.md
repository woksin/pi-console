# TUI bake-off (M0): results and recommendation

Status: recommendation, pending the owner's review ([ADR-0003](../adr/0003-tui-stack-bake-off.md)).

Three candidates built the same two screens (fleet overview and session detail with a live streaming transcript) against the same mock daemon and the same visual spec. Criteria, in order: visual quality, then UX and interaction quality, then everything else.

## Fleet overview at 200x50

| OpenTUI (React renderer) | Bubble Tea v2 + Lip Gloss v2 | pi-tui |
|---|---|---|
| ![OpenTUI fleet](../../spikes/tui-opentui/overview-200.png) | ![Bubble Tea fleet](media/tui-bubbletea-fleet-200x50.png) | ![pi-tui fleet](media/tui-pitui-fleet-200x50.png) |

Session detail: [OpenTUI](../../spikes/tui-opentui/session-200.png), [Bubble Tea](media/tui-bubbletea-detail-200x50.png), [pi-tui](media/tui-pitui-detail-200x50.png). Recordings: [OpenTUI](../../spikes/tui-opentui/demo.gif), [Bubble Tea](media/tui-bubbletea-navigation.gif), [pi-tui](media/tui-pitui-demo.gif).

## Results

| | OpenTUI 0.9.6 | Bubble Tea v2 | pi-tui |
|---|---|---|---|
| Visual quality (orchestrator's judgement from the screenshots) | High | High | High |
| Interaction built in the spike | Per-block expand by click, panes stack below 100 columns | Global expand, rail hidden below 100 columns, theme switch | Gradient wordmark, row highlight on change, bounded tail |
| Implementer self-score (visual / UX) | see spike README | 8 / 8 | 8 / 7.5 |
| CPU while streaming 5,000 entries/s (mean) | 16.9% | 17.1% | 19.9% (peak 41.9%) |
| Memory (peak RSS) | 269 MiB | 29 MiB | 283 MiB |
| Runtime and distribution | Node 26.8+ with `--experimental-ffi`, platform-native binaries, pre-1.0 | Single native executable (~11 MiB), no runtime | npm, Node ≥ 26 (spike), not a single binary |
| Shares TypeScript with the web UI | Yes (React) | No (Go client of the daemon API) | Yes |
| Maturity | Pre-1.0; experimental Node FFI | v2 stable since Feb 2026 | Tied to pi's release cadence |

## Findings

1. **Look is not what separates them.** Given the same spec, all three reached nearly the same look: dense rows, block sparklines, amber "needs you", coloured status pills and a fleet burn chart. At this level, how good it looks depends on the design work, not on the library.
2. **The real differences are footprint, distribution and maturity.** Bubble Tea uses about a tenth of the memory, ships as one binary with no runtime, and is stable. OpenTUI needs an experimental Node flag and native artefacts, and is pre-1.0. pi-tui is the heaviest under load.
3. **TypeScript sharing matters less than expected.** The TUI is a client of a documented HTTP + SSE contract with JSON Schemas ([API v0](../api/v0.md)). A Go client can be generated from those schemas, so the web UI and the TUI share the contract, not the code.

## Recommendation

**Bubble Tea v2 + Lip Gloss v2 + Bubbles v2**, with the Charm ecosystem for further polish: Harmonica spring animation, Glamour for Markdown, Lip Gloss tables and trees, Huh for forms in the intervention composer, and VHS for recordings in CI. Distribute it as a native binary per platform (Homebrew, and an npm wrapper package with per-platform optional dependencies, like esbuild), so pi users still install it with npm.

Runner-up: OpenTUI. Reconsider it when it reaches 1.0 and runs on stable Node without experimental flags.

The in-pi panel ([ADR-0003](../adr/0003-tui-stack-bake-off.md), option c) is a separate small piece that must use pi's own TUI. It stays pi-tui regardless of the standalone stack.

## Gaps carried into M1

- Visual ambition: motion (spring-eased highlights, animated message edges in the communication graph) and the signature views were not part of the bake-off.
- Code Health exceptions in all three spikes; spike code is not carried forward as is.
- Root `npm run check` fails on the Arc spike's generated proxies (`spikes/arc-ts/client/generated/All.ts`, TypeScript parameter properties under strip-only mode). Fix in M1.
- API v0 gaps found by the clients: structured tool results (success or failure), and a request link on each user transcript entry.
