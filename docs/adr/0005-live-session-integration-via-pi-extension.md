# ADR-0005: Live session integration through an outbound pi extension

- Status: Accepted
- Date: 2026-11-20

## Context

Tailing files gives history and near-live status but cannot give token-level streaming or deliver an intervention to a running session. Facts [R4, R5 Part B]:

- pi's RPC and JSON modes only work for a process the console starts itself; they cannot attach to running TUI sessions.
- No safe keystroke-injection IPC exists. Existing control paths into sessions are message files, the pi-orch inbox, the question store's CLI and the launch wrapper.
- pi extensions can hook events (`session_*`, `agent_*`, `turn_*`, `message_*`, `tool_execution_*`, `input`, and others) and can inject messages with `sendUserMessage` and `sendMessage` (delivery modes steer, follow-up, next turn), and abort with `ctx.abort()`. Token streaming (`message_update`) never reaches the session file.
- A session may be a subagent with no UI; handoffs in progress must not be interrupted.

## Options

1. The daemon injects input into terminals (keystrokes, tty).
2. The daemon writes lane message files and relies on existing delivery.
3. An in-process extension that dials out to the daemon and receives typed interventions.
4. The daemon spawns and owns pi processes (RPC mode) for console-started sessions only.

## Decision

Option 3, with option 2 as the fallback for sessions without the extension and option 4 reserved for sessions the console itself starts later.

- The `pi-console` extension is an **outbound client**: it connects over WebSocket to `127.0.0.1` (or a 0600 unix socket) on the daemon. There is no listener in any pi session.
- Auth: a per-install token read from a 0600 file; the extension sends an HMAC over session id and a nonce at connect; the daemon pins session id and pid and rejects unknown sessions.
- Upstream (extension to daemon): hello (session id, pid, cwd, lane, model, mode, `hasUI`), then a throttled and redacted stream: session lifecycle, agent and turn boundaries, `message_end` text, coalesced streaming deltas, tool start and end with truncated arguments and results, model changes, compaction, "waiting for user" prompts. The event handlers never block (bounded queue, drop on backpressure).
- Downstream (daemon to extension): a **fixed, typed set** of commands, never arbitrary code or shell: `answer` (routed to the question store's own actions), `interject` (steer and follow-up through `sendUserMessage(text, {deliverAs: "steer" | "followUp"})`, which always triggers a turn; next turn through `sendMessage({customType, content, display}, {deliverAs: "nextTurn"})`, a passive custom message that does not interrupt and is not a user message), `pause_request` (cooperative: finish the current step and write a handoff), `abort` (`ctx.abort()`, requires an explicit flag and confirmation), `handoff_request`. Unknown types are rejected.
- Every command carries id, timestamp, time to live and issuer, and the extension keeps a receipt (claim before send) so redelivery is idempotent and stale commands are rejected.
- Safety: queue instead of injecting while a handoff is in progress (read context-budget status); deliver only to primary sessions with `hasUI`; prefix injected text with `[console:<issuer>]` so the model and the user see provenance; treat console text as user-authored data subject to the same injection caution; honour a per-session opt-out (`PI_CONSOLE_OPTOUT=1`); never expose tool output beyond localhost.
- Every intervention is a **command that becomes an event** with actor, origin, token id and outcome ([event model](../event-model.md#interventions)).
- Open questions from research: whether the installed pi exposes the `agent_before_settle` hook used by context-budget is UNVERIFIED; whether a console-typed answer satisfies the question store's verbatim-input check is UNVERIFIED and must be proven in M2.

## Consequences

- Real-time transcript and safe intervention for sessions with the extension; read-only for the rest.
- The extension is small and has no inbound surface, but it runs inside every pi session, so it must be defensive (never throw, never block) and is itself part of the threat model ([security](../security.md)).
- Whether the extension can reuse TUI components depends on the TUI decision ([ADR-0003](0003-tui-stack-bake-off.md)).
- Unifies with existing buses: answers go through the question store's path; message-style interventions may also write through the pi-orch inbox so its delivery and receipt logic applies.
