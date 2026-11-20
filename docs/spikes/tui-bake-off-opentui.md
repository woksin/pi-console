# OpenTUI — M0 round-two bake-off

The round-one [shared comparison](tui-bake-off.md) is intentionally unchanged. This is the OpenTUI-only continuation: real React/OpenTUI rendering, the existing fixture and authenticated mock HTTP/SSE API, no live adapter or delivery semantics added.

## What shipped

| Requirement | Result / evidence |
| --- | --- |
| Swimlane timeline | Repository groups, collapsible rows, ticked grid, request/answer/interruption/reset/question/message glyphs, recorded-now cursor, centered zoom, keyboard/mouse pan, provenance preview, signal-to-retained-transcript jump. [120×40](../../spikes/tui-opentui/timeline-120.png), [200×60](../../spikes/tui-opentui/timeline-200.png). |
| Spatial communication graph | Layered orchestrator/lanes/subagents, routed raster links, volume brightness/counts, moving SSE packets/glow, node/edge selection and recent/conversation pane, stacked narrow layout. [120×40](../../spikes/tui-opentui/graph-120.png), [200×60](../../spikes/tui-opentui/graph-200.png), [edge](../../spikes/tui-opentui/edge-120.png). |
| Intervention composer | Context header and last request; multiline steer/follow-up/next-turn, guarded abort and question-bound answer; validation, transport errors, duplicate-submit lock, HTTP 202 + streamed audit acknowledgement. Explicitly **audit-only, never delivered**. [Composer](../../spikes/tui-opentui/composer-120.png), [acknowledgement](../../spikes/tui-opentui/recorded-120.png). |
| Motion | OpenTUI timelines/easing, composer overshoot, view entrance, fleet status/selection and transcript block highlight interpolation, message packets. Actual [33.56-second PTY tour](../../spikes/tui-opentui/signature-tour.gif), not generated frame approximations. |
| Tool/thinking disclosure | Independent entry expansion via click or `[ / ]` block cursor plus Enter/space, preserving follow/pause and pinned request context. |
| Distribution | Real npm tarball + executable launcher; fresh `--omit=dev` prefix installed and launched against mock daemon. [Installed CLI screenshot](../../spikes/tui-opentui/distribution-120.png). |

Full run/install/key instructions, reproducible VHS tapes and Code Health scores: [spike README](../../spikes/tui-opentui/README.md). `stty size` verified 40×120 and 60×200; the PNGs are actual terminal captures. The GIF demonstrates timeline → transcript disclosure → graph → edge conversation → multiline composer → HTTP/SSE acknowledgement → palette navigation.

## Measured animation/load cost

Command from repository root: `node spikes/tui-opentui/benchmark.mjs`, wrapped in `pi-phase run --kind test --policy direct --label m0r2-opentui --timeout 300`. VHS provided a real 120×40 PTY; mock daemon `--rate 5000`. The graph stayed foreground for 20 seconds, followed by timeline zoom/pan and palette. Renderer target is 20 FPS, max 30; OpenTUI's own animation engine is used, with no second rendering framework.

On macOS 26.6.2 arm64 / Node 26.8.1, 24 steady-state one-second samples after five-second warm-up:

| Metric | Result |
| --- | ---: |
| Process CPU, average / peak (one core = 100%) | 27.18% / 36.32% |
| RSS, average / peak | 188.20 / 217.33 MiB |
| Rendered frames/sec, average | 19.93 |
| Store updates/sec, average | 19.60 |
| Worst sampled event-loop p99 | 39.16 ms |
| Transcript entries received by last sample | 145,717 |
| Retained transcript entries in stress session | 2,500 |

Rendered frame cadence is measured from `renderer.getStats().frameCount`, not inferred from store notifications. Raw local samples: `.ai-work/opentui-benchmark-1795173758125/metrics.jsonl`; graph capture shows an active packet. This is a short synthetic run, not a leak/long-soak claim, and includes native FFI/rendering overhead. The new signature views are materially heavier than the old static fleet baseline, but stayed interactive under this workload. Do not compare these numbers directly to stacks measured on different hardware/rates/durations.

## Distribution proof and constraints

`npm pack` produced `pi-console-tui-opentui-0.0.2.tgz` (28.2 kB packed / 90.6 kB unpacked, 18 files). A fresh ignored prefix `.ai-work/opentui-r2-dist/install-final` was installed with production dependencies only. Its actual `.bin/pi-console-opentui --version` returned `pi-console-opentui 0.0.2`; its UI then connected to the mock daemon, opened graph/timeline, and exited through `q` in a real PTY. This caught and fixed a real packaging-only failure: tsx needs the shipped JSX tsconfig explicitly selected, otherwise an installed launch emits `React is not defined` even though checkout tests pass.

The launcher checks Node >=26.8 and platform, resolves its own tsx import, and invokes Node with `--experimental-ffi`. It is a genuine npm CLI, **not a standalone executable**; npm installs a native OpenTUI optional dependency and esbuild's runtime dependency. No Bun requirement. Node's experimental FFI warning is expected. Native packages exist upstream for macOS/Linux/Windows x64/arm64 and Linux musl, but only macOS arm64 installation/runtime was verified here. An initial npm-prefix pack attempt was corrected to run `npm pack` inside the package; the final clean-prefix proof is the one linked above.

## Verification

All build/test execution used `~/.pi/agent/bin/pi-phase run` with label `m0r2-opentui`; builds use `--policy fast --timeout 300`, tests use `--policy direct --timeout 300` (root/Arc checks used timeout 120). No script combining all repository gates or CI workflow exists in this checkout.

| Exact command inside phase | Result |
| --- | --- |
| `cd spikes/tui-opentui && npm run check && npm test` | PASS: strict TypeScript; 8 native/projection/validation tests. Some real animation ticks produce non-failing React `act` warnings. |
| `cd spikes/tui-opentui && npm run test:integration` | PASS: real authenticated HTTP/SSE, snapshot/backfill, bounded 5k/s load/reconnect, all five intervention types, bad abort rejection. |
| `npm test` (repository root) | PASS: 9 fixture/mock-daemon contract/integration tests. |
| `vhs spikes/tui-opentui/demo.tape && vhs spikes/tui-opentui/capture-wide.tape` | PASS: actual tour/120×40 and 200×60 captures; inspected visually. Early captures exposed an explicit-token-path startup issue; committed captures are corrected. |
| `node spikes/tui-opentui/benchmark.mjs` | PASS: actual PTY load run and metrics above. |
| `(cd spikes/tui-opentui && npm pack --pack-destination ../../.ai-work/opentui-r2-dist) && npm install --prefix "$PWD/.ai-work/opentui-r2-dist/install-final" --omit=dev "$PWD/.ai-work/opentui-r2-dist/pi-console-tui-opentui-0.0.2.tgz" && .ai-work/opentui-r2-dist/install-final/node_modules/.bin/pi-console-opentui --version` | PASS: pack/install/launcher version. |
| `vhs spikes/tui-opentui/distribution.tape` | PASS: installed package actually launched, navigated and quit. |
| `cd spikes/tui-bubbletea && go build -trimpath ./... && go vet ./... && go test -race ./... && node --test npm/cli.test.cjs` | PASS: unrelated existing Go build/vet/race suite and 3 CLI tests, for Tier 1 coverage. |
| `npm run check` (repository root) | FAIL: existing `spikes/arc-ts/client/generated/All.ts:16` parameter property is unsupported by the root checker's strip-only TypeScript mode. No unrelated/generated code changed. |
| `npm --prefix spikes/tui-pitui test` | INCOMPLETE: integration passes; smoke cannot import missing `@earendil-works/pi-tui` dependency. |
| `npm --prefix spikes/sqlite-eventlog test` | UNAVAILABLE: missing `better-sqlite3` dependency. |
| `npm --prefix spikes/arc-ts test` | UNAVAILABLE: build stops at missing `tsc`; tests do not run. |
| `git diff --check` | PASS: changed-file whitespace; no separate repository lint/formatter command exists. |

An early `npm run integration` invocation failed because the actual script is `test:integration`; the correctly named command passed. Missing dependencies in other stacks were not installed and unrelated failures were not repaired. Their full build/lint checks remain incomplete. **A fully green whole-repository Tier 1 gate was not achieved; this is not a whole-repository PR-ready claim.** Relevant OpenTUI Tier 2 integration was nevertheless run and passed.

CodeScene reviewed/scored all changed source files. Existing low-score app/transcript improved 8.40→8.49 / 8.10→8.34; store remained 10. Five explicit <9.5 uplift exceptions remain (`app`, `transcript`, `graph` 8.70, `composer` 9.05, `signature-model` 8.45); the README gives the complete before/after table and reasons. The final pre-commit Code Health safeguard passed across 14 eligible changed files; its remaining findings are improvements/known debt, not a claim that every file meets 9.5. New-file scores were also checked individually. No issue/PR was opened by the subagent.

## Honest partials and recommendation

- The graph is per repository, five nodes from this fixture, not a general-purpose global DAG. Shared raster segments can be ambiguous; a production graph would need routing/layout work. It does preserve the required three layers instead of flattening to a list.
- Timeline markers use recorded timestamps and request/reset/question/message summaries. Exact session state intervals, universal thinking/tool glyph coverage and exact event-cursor backfill are not available: marker opening uses the nearest retained transcript timestamp. These are partials, not claimed as fully solved.
- Below 100 columns panes stack; 90×30 is covered by the native interaction test, but very short/narrow strips can clip. 120×40 is the useful lower bound for the full composition.
- A graph edge does not imply an intervention recipient: composer uses the last selected session and clearly shows it. Search is bounded local retention, not full daemon search. The mock's acknowledgement remains an audit, never adapter delivery.
- Animations are terminal-cell interpolation, not pixel/browser motion. Native FFI/platform binaries and the newer Node runtime are the main distribution/security costs. The new tarball proof removes the prior “developer checkout only” gap, but cross-platform shipping is still unproven.

OpenTUI is now a credible option for the richer visual composition: spatial drawing, native React tree, actual motion and editor behavior all work without a browser. Prefer it if these capabilities justify the experimental FFI/native distribution dependency. Do not select a bake-off winner from this single-stack report; compare the other stacks' round-two evidence and resolve the incomplete global gate first.
