# Information architecture

How the console is organised: entities, navigation, status semantics, screens (web and TUI), signature views, keyboard map and visual style. Wireframes are ASCII sketches of layout and information, not pixel designs. The TUI toolkit is not yet chosen ([ADR-0003](adr/0003-tui-stack-bake-off.md)); wireframes assume only a full-screen terminal of at least 120x36 cells with true colour.

## 1. Entities

| Entity | Meaning | Main sources ([event model](event-model.md)) |
|---|---|---|
| Session | One pi process run, identified by session id; has cwd, model, role (main or subagent), context pressure | session JSONL, context-budget status, pi-orch heartbeats |
| Lane | A named worker slot (`L<n>`, coordinator `L0`) bound to a repository, branch and worktree; may have several sessions over time | lanes registry, lane-status |
| Orchestrator | A session or lane that coordinates other lanes (coordinator or repository orchestrator) | lanes registry (`coordinator`, role) |
| Subagent | A short-lived child session started by a session; has a type and a result | subagent records, task outputs, workflow journals |
| Request | A human-origin prompt. Status: open, answered, unanswered, interrupted (cut by a reset or abort) | session JSONL; later the intent-memory journal |
| Answer | The assistant's final output for a request (interim answers are linked, not primary) | session JSONL; later the answers log |
| Question | A structured item an agent asks the human: kind question, decision, approval or fyi; options; urgency; blocking flag | question store |
| Message | A lane-to-lane or AI-to-AI message (file, inbox item, broadcast) with read state | lane messages, pi-orch inbox and receipts |
| Job | A background process started by a session, with log and completion | job logs, job completion messages |
| Phase | A build, test or integration run in the shared queue (queued, running, finished) | phase ledger and waiters |
| Issue claim | A session's claim on an issue with state (in-progress, in-review, blocked, paused, done) | issue-work register |
| Handoff / reset | A context boundary: handoff committed, compaction, relaunch | session JSONL compaction entries, context-budget events, handoff files |
| Intervention | A command from the console to a session or question (answer, steer, follow-up, pause, abort) with actor and result | produced by the console itself |

Relations: Lane 1..n Session; Session 0..n Subagent; Session 1..n Request; Request 0..n Answer; Session 0..n Reset; Request may be listed in a Reset's open requests; Question links to asker session and lane; Intervention targets Session or Question.

## 2. Status taxonomy

Colours and glyphs carry fixed meaning in web and TUI. Colour is never the only signal: each status also has a glyph and a text label, and the TUI falls back to the glyph and label on 16-colour terminals.

| Status | Glyph | Colour role | Applies to | Rule |
|---|---|---|---|---|
| Needs you | `!` | amber | session, lane, question, request | An open blocking question, an unanswered or interrupted request, or a pending approval |
| Working | `*` | cyan | session, lane, job, phase | Active turn or tool call within the staleness window |
| Waiting | `~` | violet | lane, session | Waiting on a dependency or another lane (lane-status `waiting-on`, `barred-by`) |
| Idle | `-` | slate (dim) | session, lane | Turn ended, no open request |
| Blocked / stuck | `x` | orange | session, lane | Watchdog state stuck, repeated errors, or blocked on a guard |
| Failed | `x` | red | job, phase, subagent, intervention | Non-zero exit, error stop reason, delivery failure |
| Done | `v` | green | job, phase, subagent, request, issue claim | Completed successfully or answered |
| Interrupted | `/` | magenta | request, session | A reset or abort cut off the work before a final answer was recorded |
| Stale / unknown | `?` | grey, dotted | session, lane | No heartbeat for more than five minutes, or the source is missing |

Precedence for a session's badge: Needs you, Blocked, Failed, Interrupted, Working, Waiting, Idle, Stale. Staleness uses the same five-minute heartbeat rule as the existing watchdog [R4 §S5]. Status is computed by projections, never stored by ingestion.

## 3. Navigation

Primary sections (web sidebar, TUI tab bar or number keys `1`-`9`):

| Key | Section | Purpose |
|---|---|---|
| `1` | Overview ("Needs you") | Attention inbox first, fleet summary second |
| `2` | Fleet | Sessions and lanes, grouped by repository and orchestrator |
| `3` | Requests | Never-lost requests and answers log |
| `4` | Questions | Queue of questions and decisions; answer in place |
| `5` | Messages | AI-to-AI messages, list and graph |
| `6` | Timeline | Swimlane view of all sessions |
| `7` | Work | Jobs, phases, issue claims, reviews |
| `8` | Direct | Direct work queue and local runners (from M4) |
| `9` | Activity | Audit log of interventions and system events |

Always available: command palette (`Ctrl+P` or `:`), global search (`/`), settings (`,`), help (`?`). Session detail opens from any list with `Enter` and closes with `Esc`. Every list and every view is addressable by URL in the web UI and by a command in the TUI (`:session <id>`, `:request <id>`).

## 4. Screens

Common to all lists: `/` filters, `[` and `]` step through saved filters, `s` sorts, `Space` multi-selects, `Enter` opens, `a` acts (answer or steer, when allowed), `y` copies the id. Detail bodies load lazily from source files by offset ([architecture](architecture.md)).

### 4.1 Overview / "Needs you"

Answers "what needs me now". Sections in order: Needs you (amber), Interrupted requests, Blocked or stuck, Working summary, Host health (queue depth, disk, provider limits).

Web:

```text
+-----------------------------------------------------------------------------------------+
| pi-console   Overview  Fleet  Requests  Questions  Messages  Timeline  Work  Activity  Ctrl+P |
+--------------+--------------------------------------------------------------------------+
| NEEDS YOU  4 | ! Q-412  Decision  high  blocking          L118 pi-setup        3m ago   |
| ! Q-412      |   Which retention policy for session blobs?   [A] 14 days  [B] 30 days    |
| ! Q-409      |   [ Answer A ] [ Answer B ] [ Open ] [ Defer ]                            |
| / REQ-8841   +--------------------------------------------------------------------------+
| / REQ-8838   | / REQ-8841  Interrupted by reset #3     L192 pi-console      42m ago     |
|              |   "compare the two stack options and write the ADR ..."                   |
| BLOCKED   1  |   Last answer: none recorded      [ Open session ] [ Re-ask ]            |
| x L131       +--------------------------------------------------------------------------+
|              | WORKING 11   ####------ 11/40 lanes  ctx p50 38%   cost today $41.20     |
| HOST         | sparkline tokens/min  .:::-=+*####*+=-:..   queue: 2 running, 1 queued    |
| queue 2/1    | 51 GiB free   provider: anthropic ok, openai ok                          |
+--------------+--------------------------------------------------------------------------+
```

TUI:

```text
 pi-console  1 Overview  2 Fleet  3 Requests  4 Questions  5 Messages  6 Timeline     ctx 38%  $41.20
 ┌ NEEDS YOU (4) ─────────────────────────────────────────┐ ┌ HOST ─────────────────────────┐
 │ ! Q-412 decision  high  blocking   L118   3m           │ │ queue  running 2  queued 1    │
 │   Which retention policy for session blobs?            │ │ disk   51 GiB free            │
 │   [a] 14 days  [b] 30 days   ⏎ open   d defer         │ │ tokens/min ▁▂▃▅▇█▆▄▃▂▂▃▅▆      │
 │ / REQ-8841 interrupted by reset #3  L192  42m          │ └───────────────────────────────┘
 │   "compare the two stack options and write the ADR…"   │ ┌ WORKING (11) ────────────────┐
 │ / REQ-8838 interrupted               L140  1h          │ │ * L192 pi-console   ctx 41%   │
 │ x L131 blocked: guard denied push    L131  7m          │ │ * L118 pi-setup     ctx 72%   │
 └────────────────────────────────────────────────────────┘ │ * L205 chronicle    ctx 18%   │
 j/k move  ⏎ open  a answer  / filter  Ctrl+P palette  ? help                └───────────────┘
```

Empty state: a calm message, "Nothing needs you. 11 sessions are working.", with the working summary promoted.

### 4.2 Sessions and lanes (fleet)

A table grouped by repository and orchestrator. Columns: status, lane, session name, repo and branch, model, context pressure bar, last activity, open requests, issue claim. Group headers collapse. Subagents are collapsed under their parent with a count.

Web:

```text
 Fleet   group: repo v   filter: status:working,needs-you        [Table] [Graph] [Timeline]
 ----------------------------------------------------------------------------------------
 v pi-setup (5)
   ! L118  pi-setup#sweep      sonnet-5.5  ctx [########--] 78%  2m   req 1  #214 in-review
   * L119  review-train        opus-5.5    ctx [####------] 38%  now  req 0  #220 in-progress
     └ 3 subagents running
 v pi-console (2)
   * L192  console             opus-5.5    ctx [#####-----] 51%  now  req 1  #192 in-progress
   - L193  tui-spike           sonnet-5.5  ctx [##--------] 19%  9m   req 0
```

TUI: same columns as a virtualised table; `Tab` toggles table, graph and timeline; `Space` on a group collapses it.

### 4.3 Session detail

Left: live transcript timeline with reset markers. Right rail: requests and answers for this session, subagents, jobs, context pressure. Transcript entries are collapsed by default (progressive disclosure): assistant text, tool calls, tool results, file edits, custom messages. Reset markers are full-width rules that name the boundary kind and list the open requests carried across.

Web:

```text
 L192 console  * working   opus-5.5  ctx [#####-----] 51%  cwd pi-console   [Steer] [Pause] ...
 +----------------------------------------------------+-------------------------------------+
 | 09:12 > you  "compare the two stack options ..."   | REQUESTS (3)                        |
 | 09:12 < assistant  thinking ... (collapsed)         |  v REQ-8830 answered 09:20          |
 | 09:13   tool bash  rg "Chronicle" docs   0.4s  v    |  / REQ-8841 interrupted (reset #3)  |
 | 09:15 < assistant  "Both options work. I would ..." |  ! REQ-8850 open  "write the ADR"   |
 | ==== reset #3 handoff committed 09:31 ============= +-------------------------------------+
 |      carried: REQ-8841 (open), REQ-8850 (open)       | SUBAGENTS (2)  * explore#2adc  3m   |
 | 09:32 < assistant  resuming from handoff ...         |                v scout#91ff    done |
 | 09:33   tool read ... (streaming ▌)                  +-------------------------------------+
 |                                                      | JOBS  j13 inbox-watch  * 41m        |
 +----------------------------------------------------+ CONTEXT  ▁▂▃▅▇▆▄▅▆█  (tokens/turn)  |
 | [ type to steer / follow up ...            ] [Send] +-------------------------------------+
```

TUI:

```text
 L192 console  * working  opus-5.5  ctx ▕█████░░░░░▏51%       s steer  p pause  A abort  r requests
 ┌ transcript ──────────────────────────────────────────┐┌ requests ───────────────────────┐
 │ 09:12 ▸ you  compare the two stack options …         ││ v REQ-8830 answered             │
 │ 09:13   ⚙ bash rg "Chronicle" docs        0.4s       ││ / REQ-8841 interrupted (reset 3)│
 │ 09:15 ◂ assistant  Both options work. I would …      ││ ! REQ-8850 open                 │
 │ ───── reset #3  handoff committed  09:31 ─────────── │├ subagents ──────────────────────┤
 │       carried: REQ-8841, REQ-8850                    ││ * explore#2adc  3m   v scout#91 │
 │ 09:33   ⚙ read …                           ▌ live    │├ jobs ───────────────────────────┤
 └──────────────────────────────────────────────────────┘│ j13 inbox-watch  * 41m          │
 ⏎ expand  f follow  / search  Tab pane  [ steer: _                                      ]
```

### 4.4 Requests and answers (never-lost log)

One row per request, newest first, with its answer inline. Filters (saved views): All, Unanswered, Interrupted by reset, Answer possibly unseen, Today, By repository or lane. Opening a row shows the verbatim request, the final answer (verbatim, bounded, with a pointer to the source), interim answers, and the reset boundaries between them.

Web:

```text
 Requests   [All] [Unanswered 2] [Interrupted 3] [Answer unseen 1]    search: ______   14d v
 ----------------------------------------------------------------------------------------
 / REQ-8841  L192  42m  "compare the two stack options and write the ADR ..."
                        interrupted by reset #3 | no answer recorded   [Open] [Re-ask]
 ! REQ-8850  L192  12m  "write the ADR for the TUI stack"        open, working
 v REQ-8830  L192  1h   "summarise R4 sources"                   answered 09:20 (1.2 KB)
     answer: "R4 lists 17 sources. The primary one is session JSONL ..."   [Copy] [Open]
 ? REQ-8822  L140  3h   "why did CI fail?"   answered, possibly unseen (reset right after)
```

TUI:

```text
 Requests  f:interrupted,unanswered   14d                                    3 of 212
 ┌──────────────────────────────────────────────────────────────────────────────────────┐
 │ / REQ-8841 L192 42m  compare the two stack options and write the ADR …   interrupted │
 │ ! REQ-8850 L192 12m  write the ADR for the TUI stack                     open        │
 │ ? REQ-8822 L140  3h  why did CI fail?                       answered, possibly unseen│
 ├──────────────────────────────────────────────────────────────────────────────────────┤
 │ REQ-8841  "compare the two stack options and write the ADR …"                        │
 │ answer: none. boundary: reset #3 handoff, 09:31, open requests carried: 2            │
 │ [R] re-ask   [o] open session at request   [y] copy id                               │
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

Derivation and states are specified in [ADR-0008](adr/0008-relationship-to-intent-memory.md) and the [event model](event-model.md).

### 4.5 Questions queue

The human decision queue. Columns: kind, urgency, blocking, asker lane, age, options. Answering is inline: choose an option or type free text. Answers go through the question store's authorised path ([ADR-0005](adr/0005-live-session-integration-via-pi-extension.md)), not by editing files. Deferred, superseded and closed items are filters.

Web:

```text
 Questions   open 7   blocking 3   [Mine] [Deferred] [Decided]
 ----------------------------------------------------------------------------------------
 ! Q-412  decision  HIGH blocking  L118  3m
   Which retention policy for session blobs?
   ( ) A  14 days   (*) B  30 days   recommended: A       [ Answer ] [ Defer v ] [ Cc ]
   asker context: L118 pi-setup, branch l118/sweep, issue #214        (history: 2 revisions)
 - Q-409  approval  normal            L205  22m   "Merge PR 77?"   [Approve] [Reject]
```

TUI:

```text
 Questions  open 7  blocking 3
 ┌────────────────────────────────────────────────────────────────────────────────────┐
 │ ! Q-412 decision HIGH blk  L118  3m  Which retention policy for session blobs?      │
 │ - Q-409 approval norm      L205 22m  Merge PR 77?                                   │
 ├────────────────────────────────────────────────────────────────────────────────────┤
 │ Q-412   a) 14 days  (recommended)   b) 30 days                                      │
 │ asker: L118 pi-setup #214                                                           │
 │ press a or b to choose, t to type, d defer, c cc lane          Enter confirm        │
 └────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.6 Messages (AI to AI)

List mode: sender, recipients, topic, age, read state (from per-lane markers), kind (normal, broadcast, urgent). Graph mode is the [communication graph](#52-live-ai-communication-graph). Message bodies are Markdown and are rendered as untrusted text ([security](security.md)).

### 4.7 Jobs, phases, CI

Three tables: jobs (id, session, command, age, state, log tail), phases (kind, label, state, queue wait, duration, exit code), issue claims and review rounds (verdict per head SHA). Failed items link to the owning session.

```text
 Work    [Jobs 14] [Phases 3] [Claims 22] [Reviews]
 PHASE  build   "Release build"   L118   * running 02:14   queue wait 0:41
 PHASE  test    "unit specs"       L205   ~ queued  #1      expected 05:00
 JOB    j13     inbox-watch        L192   * 41m  last output 12s ago
```

### 4.8 Activity / audit log

Chronological log of interventions and system events: time, actor (user or token id), origin (web, TUI, MCP, extension), command, target, result, correlation id. Immutable; filters by actor and target; export as JSONL.

### 4.9 Settings and security

Sources (enabled, backfill window, last checkpoint, lag), tokens (create, scope read-only or control, revoke, rotate), remote access status, redaction rules, data directory and size, retention. Shows a persistent banner when remote access is on.

## 5. Signature views

Six views that carry the product's identity. Each has a TUI and a web wireframe. Motion is subtle and optional ([section 8](#8-visual-style)); every animated element has a static equivalent for reduced motion and for terminals without true colour.

Fleet (4.2) and Overview (4.1) are the baseline screens; the views below go beyond them.

### 5.2 Live AI-communication graph

Lanes, orchestrators and subagents are nodes; messages are edges that pulse when a message is sent and fill on delivery and read. Node size is context pressure or activity; node ring colour is the status taxonomy. Orchestrators are laid out as hubs with their lanes around them; subagents hang off their parent. Clicking an edge opens the message; clicking a node opens the session. A time scrubber replays the last hour from events.

Web (SVG/canvas, force-directed with fixed orchestrator hubs):

```text
 Messages  [List] [Graph]   window: last 1h v   [> live]  ----o------------- 09:41
 +------------------------------------------------------------------------------------+
 |                         (L131)                                                      |
 |                           ^  .  .                                                   |
 |        (L118)<----------[ L0 coordinator ]------->(L205)                            |
 |          ^ .               |      ^   .               |                             |
 |          .  (sub)          v      .    (sub)(sub)     v                             |
 |        (L119)           (L192) <.. .. ..           (L140)                           |
 |   legend: ring=status  size=ctx%  --- delivered  ... unread  edge pulse = new msg   |
 +------------------------------------------------------------------------------------+
 | 09:41  L0 -> L192  "re-plan with Sol"   read 09:42      [Open message]             |
```

TUI (braille canvas for edges, box nodes; animated pulse by cycling an edge's colour and a `◦` travelling along it):

```text
 Messages · graph   1h   ● live                                              ⏎ open  t scrub
              ┌────────┐         ┌────────┐
              │  L131  │         │  L205  │
              │ ! 2 req│         │ * 31%  │
              └───┬────┘         └───┬────┘
                  ⠈⠑⠢⣀◦⣀⠔⠊          ⡠⠔⠊⠁
              ╔═══▼══════════════════▼═══╗   hub = orchestrator
              ║  L0 coordinator  * 44%   ║
              ╚═══╤══════════════════╤═══╝
              ┌───▼────┐         ┌───▼────┐
              │  L118  │         │  L192  │── ▫ explore#2adc  ▫ scout#91ff
              │ * 78%  │         │ * 51%  │
              └────────┘         └────────┘
 09:41 L0 → L192 "re-plan with Sol"  read 09:42
```

For large fleets the graph shows only edges active in the window and collapses idle nodes into a count. For no-motion terminals the pulse becomes a static recency colour.

### 5.3 Swimlane timeline of all sessions

One horizontal lane per session (grouped by repository), time on the x axis. Bars show working, waiting and idle spans. Markers: reset or compaction (vertical rule with kind), request (up-triangle), answer (down-triangle, filled when final), question asked (amber dot), subagent span (thin nested bar), intervention (diamond). An interrupted request draws a dashed line from its marker to the reset that cut it off. Zoom from 30 minutes to 14 days; a "now" cursor follows live.

Web:

```text
 Timeline  last 4h v  group: repo v  [x] subagents [x] messages        zoom - +   now |
 ----------------------------------------------------------------------------------------
 pi-setup  L118 ░░████████▒▒▒▒██████░░██████████ ▲REQ-8841-----|reset#3  ▼ ◆steer
           └ sub    ·····███·····██████·····
 pi-console L192 ██████████████|reset#2████████████████████████▲REQ-8850
 chronicle L205 ░░░░░░░░░░░░░░██████████████████████▒▒▒▒░░░░░░░ ● Q-409
           09:00        09:30        10:00        10:30        11:00        11:30 ▏now
 legend: █ working  ▒ waiting  ░ idle  | reset  ▲ request  ▼ answer  ● question  ◆ intervention
```

TUI (same glyphs; one row per session, horizontal scroll with `h`/`l`, zoom with `+`/`-`):

```text
 Timeline 4h  zoom 5m/col                       ◀ h   l ▶   + zoom in   - zoom out
 L118 pi-setup   ░░████████▒▒▒▒██████░░██████▲····┆reset3·▼  ◆
 L192 console    ██████████┆reset2███████████████████████▲
 L205 chronicle  ░░░░░░░░░░░░░░███████████████████▒▒▒▒░░░░●
                 09:00      09:30      10:00      10:30     now
```

### 5.4 "Needs you" inbox with inline answer and steer

The Overview ([4.1](#41-overview--needs-you)) is the inbox. Each card has actions that complete in place, without leaving the inbox: answer a question (option buttons or free text), approve or reject, defer, steer the asking session ("also consider X"), mark a request as handled in the console view (display only until the intent store supports resolution, [ADR-0008](adr/0008-relationship-to-intent-memory.md)). Keyboard: `a` answer, `s` steer, `d` defer, `n` next card, `x` dismiss to "seen". Completing an action shows an undo-able toast until delivery is confirmed, then an audit link.

```text
 ┌ Q-412 · decision · HIGH · blocking · L118 pi-setup · 3m ────────────────────────────┐
 │ Which retention policy for session blobs?                                            │
 │   [a] 14 days (recommended)   [b] 30 days   [t] type answer                          │
 │ ─────────────────────────────────────────────────────────────────────────────────── │
 │ steer L118 too:  also keep the manifest for 90 days_                          [s]    │
 │ preview → L118 will receive: "[console:owner] Q-412 answered: 14 days. also keep…"   │
 │ ⏎ send answer   Esc cancel   (delivery confirmed ✓ 1.2s · audit A-3391)              │
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

Web uses the same card with buttons and an inline textarea; both share the same states: composing, sending, delivered, failed (with retry), expired.

### 5.5 Intervention composer

A single composer for all interventions on a session. Modes: **Steer** (delivered after the current tool call), **Follow-up** (delivered when the agent finishes), **Next turn** (queued for the next prompt), **Pause** (cooperative: asks the session to finish the current step and write a handoff), **Abort** (hard stop, destructive, requires confirm). A side panel previews the target: its status, current tool call, open requests, context pressure, any handoff in progress (the composer queues instead of injecting during a handoff, [R5 Part B]), and the exact text that will be delivered with its `[console:<issuer>]` prefix.

Web:

```text
 Intervene · L192 console                                                          [x]
 Mode: (*) Steer  ( ) Follow-up  ( ) Next turn  ( ) Pause  ( ) Abort
 +------------------------------------------+----------------------------------------+
 | Message                                  | TARGET PREVIEW                         |
 | [ also include the Direct adapter ... ]  |  * working  opus-5.5  ctx 51%          |
 |                                          |  now: tool read docs/architecture.md   |
 | Delivered: after the current tool call   |  open requests: REQ-8850               |
 | Will appear to the model as:             |  handoff in progress: no               |
 |  "[console:owner] also include ..."      |  last intervention: 12m ago (steer)    |
 +------------------------------------------+----------------------------------------+
 [ Cancel ]                                                     [ Send steer  Ctrl+Enter ]
```

TUI:

```text
 ┌ Intervene · L192 console ───────────────────────────────────────────────────────────┐
 │ mode  ◉ steer  ○ follow-up  ○ next turn  ○ pause  ○ abort          ←/→ or 1-5       │
 │ ┌ message ─────────────────────────────┐ ┌ target ───────────────────────────────┐ │
 │ │ also include the Direct adapter…▌   │ │ * working  opus-5.5  ctx 51%          │ │
 │ └──────────────────────────────────────┘ │ now: read docs/architecture.md        │ │
 │ delivered after current tool call        │ handoff in progress: no               │ │
 │ model sees: [console:owner] also …       └───────────────────────────────────────┘ │
 │ Ctrl+Enter send   Esc cancel                                                        │
 └─────────────────────────────────────────────────────────────────────────────────────┘
```

Abort and any action on more than one session ask for typed confirmation of the lane id. Rate limits and scopes are described in [security](security.md).

### 5.6 Command palette

Opens with `Ctrl+P` (or `:` in the TUI). Fuzzy search across commands, sessions, lanes, requests, questions and messages. Results are ranked by the current view (context-first), then recency. Each result shows its type, a status glyph and a key hint. Supports prefixes: `>` commands, `@` lanes, `#` issues and questions, `/` search transcripts, `!` interventions.

```text
 ┌ ─────────────────────────────────────────────────────────────────────────────────── ┐
 │ ▸ steer l1_                                                                          │
 │ ──────────────────────────────────────────────────────────────────────────────────── │
 │  @ L118  pi-setup#sweep        * working        s steer   ⏎ open                      │
 │  @ L119  review-train          * working        s steer                               │
 │  @ L131  pi-cli                ! needs you      s steer                               │
 │  > Steer…  (current view: Fleet)                                                      │
 │  > Pause lane…                 > Abort lane…  (confirm)                               │
 │ ──────────────────────────────────────────────────────────────────────────────────── │
 │ ↑↓ choose  ⏎ run  Tab complete  Esc close                            12 of 214        │
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

The web palette is the same component with mouse support and previews on the right.

### 5.7 Direct / MCP and local runners panel (from M4)

Read-only first. Shows the Direct work queue (assigned items, gate reviews, open agent questions, drift and held journeys), the event feed, and local runners with state, health and load. Write actions (answer a question) appear only when the token scope and Direct permit them. If no Direct connection is configured, the panel shows an empty state that explains how to connect ([ADR-0007](adr/0007-mcp-server-and-direct-adapter.md)). No dispatch or pause controls are drawn, because none exist over Direct's MCP today [R5 Part A].

Web:

```text
 Direct   connected: tenant acme  PAT expires in 41d        [Work] [Runners] [Events]
 +-----------------------------------------+------------------------------------------+
 | MY WORK (6)                             | LOCAL RUNNERS                            |
 | ! agent question   #2355  "scope?"  2m  |  runner-mac   connected  * busy   load 2 |
 | ~ gate review      #3012            1h  |  runner-ci    connected  - idle   load 0 |
 | * assigned         #3040            3h  |  runner-old   offline    ?        --     |
 +-----------------------------------------+------------------------------------------+
 | EVENTS  agent_question #2355 · question_answered #2321 · drift #3127  (cursor 8841) |
```

TUI:

```text
 Direct  ● connected  tenant acme                                   w work  r runners
 ┌ my work ───────────────────────────────┐ ┌ runners ────────────────────────────────┐
 │ ! agent question #2355 "scope?"     2m │ │ runner-mac  * busy  load 2              │
 │ ~ gate review    #3012              1h │ │ runner-ci   - idle  load 0              │
 │ * assigned       #3040              3h │ │ runner-old  ? offline                   │
 └────────────────────────────────────────┘ └─────────────────────────────────────────┘
 empty state (no connection): "Direct is not connected. Run: pi-console direct connect"
```

## 6. Keyboard map

Same keys in web and TUI wherever possible. Footer bar in the TUI always shows the keys valid in the current context.

| Key | Action |
|---|---|
| `1`-`9` | Switch section |
| `Ctrl+P`, `:` | Command palette |
| `/` | Filter current list; in a transcript, search |
| `[` `]` | Previous and next saved filter |
| `j` `k` or arrows | Move; `g` `G` top and bottom |
| `Enter` | Open |
| `Esc` | Close, cancel, back |
| `Tab`, `Shift+Tab` | Next and previous pane |
| `a` | Answer (question) |
| `s` | Steer (opens composer, mode steer) |
| `f` | Follow-up in composer; in a transcript, toggle follow-tail |
| `p` | Pause |
| `A` | Abort (typed confirmation) |
| `d` | Defer |
| `y` | Copy id |
| `Space` | Select or collapse group |
| `t` | Toggle time scrubber (graph, timeline) |
| `?` | Help |
| `Ctrl+C` | Quit TUI (never aborts a session) |

Destructive keys are uppercase and always confirm. The web UI adds standard mouse and touch interactions; the phone layout collapses the sidebar to a bottom bar and puts "Needs you" first.

## 7. Cross-cutting behaviours

- **Live updates**: lists update in place without losing selection or scroll; new "needs you" items raise a badge and, if enabled, a desktop notification that states the reason and the next action.
- **Empty states**: every view has a purposeful empty state (see [section 8](#8-visual-style)).
- **Loading**: skeleton rows with the final column widths; no layout shift.
- **Errors**: ingestion lag or a missing source is shown on the affected rows ("source unavailable, last seen 4m ago"), not as a global failure.
- **Untrusted content**: transcripts and messages are rendered as text or sanitised Markdown; control sequences are stripped ([security](security.md)).
- **Accessibility**: status never colour-only; keyboard complete; reduced-motion setting; high-contrast theme; web UI meets WCAG AA contrast.

## 8. Visual style

Direction: a dark-first, high-density, "instrument panel" look. Calm by default, expressive when something changes. Sourced observations from the research: dense, data-first layouts are the norm for observability tools and TUIs; command-first minimal chrome (Linear, Raycast); semantic status colours that stay fixed (k9s skins); mnemonic key hints in a footer (k9s, lazygit) [R1]. The palette and effects below are the product's own recommendations, not sourced.

**Palette and themes**

- Backgrounds: near-black slate (`#0b0e14` family) with two raised surfaces; light theme and a high-contrast theme share the same semantic tokens.
- Text: one neutral ramp (5 steps). Accent for focus and selection: a cool cyan to indigo gradient.
- Status colours are semantic tokens (section 2): needs-you amber, working cyan, waiting violet, blocked orange, failed red, done green, interrupted magenta, stale grey.
- Themes are true-colour (24-bit) with automatic degrade to 256 and then 16 colours, using perceptual (OKLab or OKLCH) interpolation so gradients stay smooth. Theme files are plain data (token to colour), shared by web (CSS variables) and TUI. Bundled themes: Midnight (default), Dawn (light), Contrast, and a mono theme that uses weight and glyphs only.

**Gradients and surfaces**

- Context-pressure bars use a green to amber to red gradient with the soft and handoff thresholds drawn as ticks.
- Section headers and the focused pane border use a subtle two-stop gradient; web uses a faint noise-free glow on focus, no drop shadows.
- Cards in the inbox carry a thin left edge in the status colour.

**Charts and sparklines**

- Per-session and fleet token burn and cost burn as braille or block sparklines (`▁▂▃▅▇█`, braille `⣀⣤⣶⣿`) in rows and headers; a btop-style full panel (stacked area per model or per repository, cost per hour) on the Overview detail.
- Context pressure per turn as a sparkline in session detail, with reset markers as vertical ticks.
- Web uses the same data as canvas or SVG with identical colour tokens.

**Motion** (all optional, off with reduced-motion and on slow terminals)

- Edge pulses on new messages in the graph; a short fade or slide when a card enters the inbox; smooth, throttled streaming of transcript text (batched redraw, at most 30 frames per second); a brief highlight on rows whose status changed; eased scrolling and a "jump to live" indicator.
- Motion never blocks input and never runs when the window is hidden.

**Typography and density**

- Web: system UI sans for chrome, a monospace for transcripts, tool calls and ids, tabular numerals for tables and timers; 12 to 13 px body; compact rows (one line per session, two-line cards for needs-you); progressive disclosure for logs.
- TUI: Unicode box drawing with rounded corners where the toolkit supports it; Nerd-Font-free by default (plain Unicode glyphs); an optional icon set when a Nerd Font is detected.

**Empty states and first run**

| View | Empty state |
|---|---|
| Overview | "Nothing needs you." plus working count and a small sparkline; a gentle idle animation in motion mode |
| Fleet | "No pi sessions found yet." with the expected sources and how to enable them; shows backfill progress |
| Requests | "No requests recorded yet." plus a one-line explanation of what is tracked and the backfill window |
| Questions | "No open questions. Agents ask here when they need you." |
| Timeline, graph | Axes and legend drawn with a faint placeholder trace and "Waiting for activity" |
| Direct | Connection instructions; no controls drawn |
| First run | A three-step checklist: daemon running, sources detected, extension installed (optional) |

**Open points**: exact palette hex values, the icon set and the reduced-motion defaults are finalised during the M0 visual bake-off ([milestones](milestones.md)); screenshots and terminal recordings from the bake-off are the acceptance evidence.
