# Vision

## Problem

pi runs many long-lived sessions: a coordinator, repository orchestrators, worker lanes and short-lived subagents. Three problems follow.

**1. Resets drop what the human asked for.** Each session resets context many times (handoff or compaction). Findings from the context-memory study (final report):

- Across 33 days of session files, 657 sessions had at least one reset, 171 had three or more, 95 had ten or more. The coordinator session had 136 resets and was still running [study §2].
- A model-rewritten summary is the only carrier of long-lived intent across a reset. Only about 46% of a directive's life was present in any wording after resets, and about 29% in the constraints section [study §3].
- Confirmed harm: a "do not start work X" directive dropped from handoffs and the work started anyway; the user had to restate rules several times [study §4].
- Summaries label assistant-invented rules as "user constraints (verbatim)", so the model cannot tell the user's words from its own paraphrase [study §5].
- The user's own report: a reset can remove the answer to a prompt, or cut a session off mid-prompt, so the result never arrives.

**2. The truth is scattered.** Session JSONL, context-budget telemetry, the lanes registry and message files, lane-status, the pi-orch store, the question store, the issue-work register, job logs, the build/test queue ledger, subagent outputs and review logs are separate stores with separate formats [R4]. The study counted about ten stores for lane-level intent alone [study §7].

**3. No way to see or steer the fleet.** There is no single place to see which session needs the human, which is stuck, what was asked and not answered, or what the AIs are saying to each other. Intervening means finding the right terminal.

## Product vision

A professional, persistent console for the whole local pi setup, with two front ends over one daemon:

- a **web UI** on localhost that can optionally be self-hosted for remote control;
- a **TUI** for the terminal, with the toolkit chosen by a visual bake-off in milestone M0 ([ADR-0003](adr/0003-tui-stack-bake-off.md)).

It visualises work, requests, answers, questions, lanes, orchestrators, sessions, subagents and AI-to-AI messages; it lets the human answer, interject, pause and abort; and it is event-sourced so the full history is auditable and can be learned from.

It does not replace the harness-level fix. The intent-memory work (journal, requests and answers log, reset-safe handoffs) fixes the loss at the source; pi-console is the durable, human-facing view of the same facts and the place to act on them ([ADR-0008](adr/0008-relationship-to-intent-memory.md)).

## Principles

1. **Never lose a human request.** Every human-origin prompt appears in the console with the answer to it, or an explicit state: unanswered, or interrupted by a reset.
2. **Local-first.** Works offline against local files; no cloud account; data stays on the machine.
3. **Event-sourced.** One append-only log is the source of truth; every screen is a replayable projection.
4. **Read before write.** Ingestion never modifies source files. Writing back goes through each tool's own authorised path.
5. **Safe intervention.** Every intervention is a typed command, confirmed when destructive, scoped by token, and recorded as an event with actor and origin.
6. **Keyboard-first, mouse-friendly.** Same mental model, status colours and commands in web and TUI. Command palette everywhere.
7. **Attention routing.** The first screen answers "what needs me now", not "what exists".
8. **Fail closed on secrets.** If text cannot be scanned for secrets, it is withheld, not stored or shown (contract invariant 4).
9. **Open source.** Useful to someone with one or two pi sessions, not only a heavy multi-lane setup.

## Personas

| Persona | Setup | Needs | Primary front end |
|---|---|---|---|
| Solo power user | 10 to 40 lanes across repositories, many resets a day | See what needs me; recover lost answers; answer questions; steer a lane | TUI daily, web on a second screen |
| Orchestrator agent | A coordinator or repo orchestrator session | Query open requests, lane state and answers without reading files; ask the human | MCP server ([ADR-0007](adr/0007-mcp-server-and-direct-adapter.md)) |
| Remote user | Same setup, away from the machine | Answer a blocking question or pause a runaway lane from a phone or laptop, safely | Web UI via Tailscale or reverse proxy |
| Open-source adopter | One or two pi sessions, no lanes | Zero-config install, a persistent transcript and request log, no surprises | Web UI or TUI, defaults only |

## Non-goals

- Not a replacement for pi's own TUI or a second renderer inside pi sessions.
- Not a new intent or memory store; it reads the intent-memory store ([ADR-0008](adr/0008-relationship-to-intent-memory.md)).
- Not a general observability platform (no OpenTelemetry collector in the MVP; see [research summary](research-summary.md)).
- Not a code editor, diff reviewer or git client in the MVP.
- Not a multi-user or multi-tenant service. One owner per install.
- No dispatch or pause of Cratis Direct work until Direct exposes it over MCP.
- No public hosting, no telemetry sent anywhere.
