# M0: extension channel (scratch-only)

**Result:** outbound loopback WebSocket + authenticated hello + steer/follow-up
round trip proven against installed pi **0.70.0**, Node **26**. An offline fixture
provider replaces the model; this proves pi's queue/transcript semantics, not
real model behaviour. Nothing installed in `~/.pi`; no existing session contacted.

## Reproduce

From the repository root (no dependencies to install):

```sh
~/.pi/agent/bin/pi-phase run --kind test --policy direct --label m0-extension --timeout 300 --log .ai-work/m0-extension/test.log -- node --test spikes/extension-channel/
~/.pi/agent/bin/pi-phase run --kind test --policy direct --label m0-extension-root --timeout 300 --log .ai-work/m0-extension/root-test.log -- npm test
node spikes/extension-channel/scratch.js
```

Run the scratch command with a caller timeout of at most 120 seconds (70 seconds
was used). Its internal deadline is 45 seconds. Defaults locate the installed pi
under `~/.local/share/pi-runtime/lib/node_modules/@earendil-works/pi-coding-agent`;
set `PI_CONSOLE_PI_DIR` to another **compatible, already installed** package root
if needed. `PI_QUESTIONS_PACKAGE` similarly overrides the read-only questions
package location, default `~/.pi/agent/local-packages/pi-questions`.

The harness creates a fresh `.ai-work/tasks/m0-extension/output/scratch-*` cwd,
0600 random token, private config directory, and ephemeral 127.0.0.1 listener.
It starts only its own pi child using `node <pi>/dist/bundle/cli.js` with:

```text
--mode rpc --no-session --no-tools --no-extensions --no-mcp --no-skills
--no-prompt-templates --no-themes --no-context-files --no-approve --offline
-e <absolute>/extension.js -e <absolute>/scratch-provider.js
--provider console-fixture --model fixture --thinking off
```

A minimal child environment points `PI_CODING_AGENT_DIR` at the scratch directory;
no inherited lane/credential variables are passed. The harness sends trivial
fixture prompts, then SIGKILLs only the process group it created in `finally`.
Do not load this extension into a normal session. Evidence stays gitignored;
`events.jsonl` omits MAC/token/nonce and permits only fixture message excerpts.
`rpc.jsonl` contains the fixture transcript. No cleanup deletes existing work.

## Observed evidence

Sanitised excerpts from a successful scratch run (identity/path omitted):

```jsonl
{"type":"hello","sessionId":"<fresh>","pid":54890,"cwd":"<scratch>","hasUI":true,"model":"fixture","mode":"rpc","lane":null}
{"type":"event","name":"turn_start"}
{"type":"receipt","id":"steer","outcome":"accepted"}
{"type":"receipt","id":"steer","outcome":"accepted","duplicate":true}
{"type":"receipt","id":"follow","outcome":"accepted"}
{"type":"receipt","id":"unknown","outcome":"unknown_type"}
{"type":"receipt","id":"expired","outcome":"expired"}
{"type":"event","name":"message_end","role":"user","text":"[console:spike] steer marker"}
{"type":"event","name":"message_end","role":"user","text":"[console:spike] follow marker"}
{"type":"event","name":"agent_before_settle"}
{"type":"receipt","id":"passive","outcome":"accepted"}
{"type":"event","name":"message_end","role":"custom","text":"[console:spike] passive marker"}
```

RPC `get_messages` assertions verify exactly one steer marker, the follow-up
marker, and the passive custom message. The last excerpt occurs **only after**
a subsequent `drain marker` prompt: `sendMessage(..., {deliverAs:'nextTurn'})`
did not itself start an agent run. `agent_before_settle` exists in the installed
runtime's extension types and actually fired. RPC contexts reported `hasUI:true`;
that flag alone is not proof of an interactive human session.

Seven Node specs cover bad HMAC/session/nonce/PID/cwd, connection replay, unknown
types, expired/future TTL, duplicate ids, failed-send claims, unsafe/capacity
rejection, frame bounds/malformed input, bounded outbox and sync/async failures.
The first directory test invocation discovered zero tests; the spec was renamed
to `protocol.test.js`, and the corrected invocation ran all seven successfully.

## Question-store finding

Read-only inspection of installed `src/extension.ts`, `src/verbatim.ts`,
`src/actions.ts`, and `src/store.ts` shows:

- Only `input` with `source === 'interactive'` enters the recent-input ring
  (32 entries). RPC and extension inputs are ignored, including prefixed console
  messages. Runtime `sendUserMessage` labels its input `source:'extension'`.
- `providedBy:'user'` requires a nonempty `verbatimUserInput` matching a
  **case-sensitive substring** of a recent interactive input after whitespace
  normalisation. This is not byte-exact matching. Otherwise the tool returns
  `verbatimUserInput must quote an actual recent human message (interactive input).`
- The scratch probe imports only `InputRing` and `resolveHome`: extension/RPC
  quotes fail; `approved by me` matches interactive `approved   by me`;
  `Approved` fails. `PI_QUESTIONS_HOME` resolves to a scratch path. No store was
  opened or written, and the actual `record_answer` tool was not invoked.
- `providedBy:'agent'` bypasses that human-quote guard; it is not human approval.

**M2:** console-origin input must remain distinguishable from human approval.
A real console answer flow needs an explicit authenticated human provenance/API
contract, not forged `interactive` input or weakened verbatim checks.

## Boundaries, risks, M2 recommendations

- HMAC-SHA256 covers `[sessionId, nonce]`; nonce is fresh per connection with a
  3-second hello deadline. Daemon pins the spawned PID/cwd and admits one session
  for its lifetime. Host and Origin checks reject browser/cross-host upgrades.
  This is a local fixture, not production enrollment or a durable identity API.
- Commands carry id/issuer/timestamp/TTL (maximum 60s), typed steer/followUp or
  passive next_turn only, and `[console:<issuer>]` provenance. Claims happen
  before delivery and persist in a 256-entry process-memory map; full means
  reject, never evict. No restart durability, reconnect, or exactly-once claim.
  `accepted` means API enqueue, **not** model consumption or approval.
- Lifecycle/turn/message_end events use a 32-entry FIFO, at most four sends per
  50ms tick, 8KiB frames, and drops above 16KiB socket backpressure. Callback
  sync errors and rejected promises are contained; no network wait in hooks.
  Receipts/events can be dropped: M2 needs independent reliable receipts,
  dropped-event metrics, resync and bounded persistent deduplication.
- The minimal RFC6455 server accepts only masked, final text frames. It rejects
  fragmentation, binary, ping and close frames rather than implementing a full
  WebSocket stack. It is not hardened for hostile local connection floods.
- Scratch markers, cwd, 0600 owner token, opt-out, hasUI and absent PI_ORCH_ID
  gate registration; the daemon separately pins the one spawned PID. Normal
  sessions, workers, context-budget handoff, reload/resume/reconnect, real TUI,
  real models and slow-model/tool interruption are **unproven**. Context-budget
  is deliberately not loaded; this is not a production fail-closed handoff
  implementation. M2 must authenticate primary-session enrollment and refuse
  unknown lane/worker/handoff state, recheck identity after session switches,
  and invalidate in-flight commands on handoff/opt-out.
- Only fixture excerpts are allowed out; arbitrary text becomes `[withheld]`.
  M2 still needs actual secret scanning, repository allowlists, policy gates,
  durable audit receipts, and adversarial/reconnect tests before live use.

## Code Health and checks

One review/refactoring pass, then one final score per JavaScript file (all new;
“before” is the initial spike draft, not a repository baseline):

| File under `spikes/extension-channel/` | Before | After |
|---|---:|---:|
| protocol.js | 8.95 | 9.68 |
| websocket.js | 9.19 | 9.09 |
| stub.js | 9.38 | 10 |
| extension.js | 8.67 | 10 |
| scratch-provider.js | 10 | 10 |
| scratch.js | 10 | 10 |
| protocol.test.js | 10 | 10 |

Spike exception: `websocket.js` remains below 9.5 and declined in the single
pass despite extracting header/unmask/request validation. Its low-level parser
complexity is retained rather than starting a score-driven loop; track for
uplift/replacement by a supported offline WebSocket server before M2. The
pre-commit safeguard checked all seven JS files and **failed** on introduced
complexity in `validEnvelope` (CC 9), `frameHeader` (CC 10), and websocket module
mean complexity (4.71). These are recorded spike exceptions, not a passing gate.
Markdown review/score attempts returned unsupported-file-type errors.

Checks on the final code state:

- Exact two wrapped test commands above: **pass**, 7 spike + 9 root tests.
- `node spikes/extension-channel/scratch.js` (70-second caller timeout): **pass**;
  scratch PID 71469 terminated, evidence in `.ai-work/tasks/m0-extension/output/scratch-KktDtY/`.
- Native check attempt (below): **failed**, unrelated pre-existing
  `spikes/arc-ts/client/generated/All.ts:16` parameter property is unsupported
  by `stripTypeScriptTypes(..., {mode:'strip'})` in `spikes/mock-daemon/check.ts:20`.
  Its chained JS/whitespace phases were not reached; no unrelated fix attempted.
- Separate JS syntax/whitespace command (below): **pass**.

```sh
~/.pi/agent/bin/pi-phase run --kind build --policy direct --label m0-extension-check --timeout 300 --log .ai-work/m0-extension/check.log -- bash -c 'npm run check && for file in spikes/extension-channel/*.js; do node --check "$file" || exit; done && git diff --check'
~/.pi/agent/bin/pi-phase run --kind build --policy direct --label m0-extension-js-check --timeout 300 --log .ai-work/m0-extension/js-check.log -- bash -c 'for file in spikes/extension-channel/*.js; do node --check "$file" || exit; done; git diff --check'
```

No CI-equivalent gate script, whole-solution build or lint/format script exists
in the root package. Tier 1 was attempted but is **not fully green** because of
the existing native-check failure; no passing CI-equivalent gate is claimed.
The bounded scratch harness supplies Tier 2 evidence, not production readiness.
