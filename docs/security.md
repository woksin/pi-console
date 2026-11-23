# Security

## Optional native memory review scope

`config.json` may opt in with `"memoryActions": true` (default false). This creates a separate 0600
`memory-control-token` in the daemon's 0700 data directory. The existing `token` remains read-only.
The control credential authorises a review request, never a claim of human presence. Supply it as
`Authorization: Bearer <memory-control-token>`; query parameters and cookies never authenticate. Bearer requests
require neither the browser-only Origin nor CSRF header. Never place either token in URLs or logs.

Load `packages/extension/src/index.ts` with pi's extension loader (or the package's `pi.extensions` manifest),
set `PI_CONSOLE_MEMORY_REVIEW=1`, and optionally set `PI_CONSOLE_URL` (default `http://127.0.0.1:4777`) and
`PI_CONSOLE_DATA_DIR` (default `~/.pi-console`). The extension reads only its separate credential file, refuses
symlink/non-private/foreign-owned credentials, and connects outbound only to a loopback daemon.
A fresh HMAC challenge authenticates **both** peers and binds session/pid/cwd plus connection generation;
raw credentials never cross the WebSocket. Host/Origin policy also applies to upgrades. A read token cannot
answer that challenge. Neither a successful handshake nor a browser click is human provenance.

Availability is scoped to both the authenticated credential and `/sessions/:id/memory-actions`; read tokens never
receive actionable readiness. The extension probes with `context-budget:memory-review/v1:probe` and `{version:1}`.
The route binds the target; only that session's recorded-proposed, non-withheld, configured-source items are eligible.
Intent expires after 30 seconds, using one shared daemon/client constant.

The provider must implement `context-budget:memory-review/v1:*` (pi-context-budget f0033fe); absence,
unknown versions, non-native UI, handoff, wrong store, unknown/child roles and ambiguous targets fail closed.
The provider alone reloads canonical item/source content, presents native pi confirmation and performs any write.
The extension forwards fixed-shape intent/result/cancel messages only; it cannot send commands or UI responders.
Receipt metadata is stored separately in `memory-actions.db`, without source text, prompts, credentials or their
authentication digest. The token identifier is a separate HMAC domain. Terminal receipt bodies are pruned after
24 hours; minimal ID tombstones still prevent redispatch, while uncertain receipts remain reconcilable.
Unauthenticated handshakes have a separate eight-connection/eight-per-second budget and one-second deadline;
they cannot occupy the 32 authenticated session slots.
Source result claims remain unverified until ingestion observes the matching human event from the configured store.
Disconnection/restart never queues or retries delivery. Receipt state `unknown` does not imply success or failure.
Same-user malicious code remains outside the threat boundary; it can already read local credentials and source files.



Decisions are in [ADR-0006](adr/0006-security-model.md). This page lists assets, threats and controls, and the specs that prove them.

## Assets

- The ability to steer or abort agents that run shell commands and hold credentials.
- Session content: prompts, tool output, file contents, which may include secrets.
- The owner token and scoped tokens; the Direct PAT.
- The audit log.

## Trust boundaries

| Boundary | Hostile input |
|---|---|
| Browser to daemon | Cross-site requests, DNS rebinding, a malicious page on another origin |
| Network to daemon (remote mode) | Any host that can reach the proxy |
| Source files to adapters | Transcript and message text written by a model or by an attacker via a prompt injection |
| pi extension to daemon | A compromised or confused session sending crafted events |
| Daemon to extension | Commands must be a fixed typed set |
| MCP clients to daemon | Agent-supplied text shown to the human |
| Other local users and processes | Reading the data directory or the token |

## Threats and controls

| # | Threat | Controls |
|---|---|---|
| T1 | DNS rebinding makes a web page talk to `127.0.0.1` | Loopback bind; Host allowlist; token required on every request including SSE and WebSocket |
| T2 | Cross-site request forges a steer or abort | Bearer authentication; Origin check on state-changing and upgrade requests; cross-site fetch refusal; no permissive CORS |
| T3 | Token theft | 256-bit random token; 0600 file; web launch token in a scrubbed `#token=` fragment, kept only in tab-scoped sessionStorage; no query-token or cookie authentication; manual rotation (delete the file, restart); a separate opt-in memory-review token, with the normal token read-only; no token in logs |
| T4 | Remote exposure by mistake | Off by default; explicit opt-in; persistent banner; Tailscale Serve or TLS proxy with trusted-proxy list; Funnel documented as not recommended |
| T5 | Secrets in stored or displayed content | Redact at ingestion; fail closed if scanning fails; credential files on a deny list; redact again at the point of return; pointers instead of copies |
| T6 | Prompt injection through transcripts, messages, questions or MCP text | Rendered as text or sanitised Markdown; control sequences stripped; links not auto-followed; console-delivered text carries a provenance prefix; interventions are typed commands, never "execute this text" |
| T7 | Hostile extension traffic or a spoofed session | Per-install secret and HMAC at connect; session id and pid pinned; message size and rate limits; unknown event types dropped |
| T8 | Abuse of interventions (a stolen control token, a runaway script) | Control scope separate from read; rate limits; typed confirmation for abort and multi-target actions; time-to-live and idempotent receipts; audit event for every command |
| T9 | Injecting into a session during a handoff | Queue instead; deliver only to primary sessions with a UI |
| T10 | Local multi-user access to data | Data directory 0700, files 0600; documented as single-user |
| T11 | Supply chain (young Cratis packages, TUI runtime) | Exact version pins; lockfile; dependency review in release workflow |
| T12 | The console becomes a second copy of sensitive data | Bounded excerpts; retention settings; blobs optional; documented cleanup |

## Native code in the TUI (FFI)

The TUI uses OpenTUI ([ADR-0003](adr/0003-tui-stack-bake-off.md)), which loads a native Zig core through Node's FFI (`--experimental-ffi`). This is the only native code the console loads beyond Node itself.

- **What loads:** the prebuilt OpenTUI native library for the host platform, shipped inside the pinned `@opentui/core` npm package, loaded in the TUI process only (never in the daemon).
- **From where:** the npm registry package at the exact pinned version (0.9.6), installed from the lockfile; never downloaded at runtime.
- **Integrity:** exact version pin plus lockfile integrity hashes; dependency review on every bump (T11).
- **No network at runtime:** the native library makes no network calls; the TUI reaches only the loopback daemon API, with the same token rules as the web UI.
- **Acceptance:** accepted by the owner (Q-378 delegation) for the TUI process. Status: **verified for M1 on Linux arm64 / Node 26** (fresh `npm ci` plus the pty interaction spec in a `node:26-slim` container, P4; see [ui-tui](ui-tui.md#tests)). Still open before the first release: the same run on Linux x64 and on the release build.

## Remote access

Supported only through (a) Tailscale Serve (tailnet only) or (b) a TLS reverse proxy that you configure with an explicit Host allowlist and trusted-proxy list. Do not expose the daemon directly. Self-host authentication (passkeys or OIDC with a single-owner allowlist) arrives in M3; until then remote use relies on the tailnet or proxy and the token.

## Possibly-moot GitHub queries

Off by default. When `sources.github-closures` is on and `githubRepositories` lists exact `owner/repo` names, the daemon runs the user's own authenticated `gh` to read the state of issues and pull requests linked from **open** questions, so the UI can mark a question "Possibly moot". Disclosure: each lookup sends the owner, repository name and number to GitHub with the user's credentials, including for **private repositories you allowlist**; nothing else leaves the machine and no question text is sent.

- Only allowlisted repositories are queried, and only when every link of a question is a recognised, allowlisted target. The allowlist cannot be changed over the API.
- `gh` is started with an argument array (never a shell), fixed read-only GraphQL, closed stdin, bounded output, a timeout, and SIGTERM then SIGKILL on timeout or shutdown. Prompts, pagers and debug output are disabled.
- One request at a time, at least 10 s apart, at most 120 per rolling hour, reserved in a private state file before the child starts; a lost or corrupt state file means a one-hour cooldown. Failures back off 15 to 60 minutes; rate limits pause for at least an hour.
- Tokens, stderr and response text are never logged, stored or served; failures are recorded as the category `unknown` only.
- The marker is advisory, is withheld for evidence older than an hour, and never changes question status. Clocks may differ by up to five minutes (a closure up to five minutes after its fetch, a fetch up to five minutes ahead of the viewer) before evidence is withheld; anything further out is ignored.
- Only links that are whole, recognised github.com references count. Link text is classified before ingestion truncates it or the API strips control characters; anything else is marked unsupported, so padding or control characters can never make a different link look recognised.
- **What is stored and served:** the allowlisted repository name, issue or pull request number, observed state, `closedAt` and `fetchedAt` (and the question they belong to) are written to the local event log and the private cache file, and are served by the authenticated loopback API. Retention follows the event log. Turning the source off, or emptying the allowlist, stops new queries but does not delete observations already recorded.

## Intent-memory store (read-only)

The `intent-memory` source reads `<agent root>/memory/events.jsonl` and `journal/*.jsonl` only: no lock, no write, no
confirm. `answers/`, `blobs/` and the prune cursor are never opened; a symlinked store root is skipped. Item text and
reasons go through the same redactor as other sources (secret-shaped content is withheld) and journal message text is
dropped at the mapper, so only origin, size and a withheld flag are kept. The handoff reader (`/sessions/:id/memory`) opens only
an absolute `.ai-work/handoffs/<name>.md` path that passes the denylist, is a regular non-symlink file of at most 256 KiB, and returns
integers only; it logs nothing and returns no path.

Configured source-root paths are trusted configuration, including every symlink in those paths. A root stays
pending until `realpath` succeeds; lookup errors fail closed and are retried on every poll. Missing roots and dangling
aliases that later resolve are treated like a fresh daemon start, even if their components appear as symlinks.
Containment starts at the resolved canonical target, pinned for discovery and file reads in that poll. Configured
paths are re-resolved on the next poll: a changed alias is re-pinned, while a failed lookup skips the root rather than
using a stale pin. Symlinked files and directories beneath that canonical trust root remain rejected.

Ingestion, transcript pages and handoff figures open the candidate with nonblocking, no-follow descriptor flags where available,
validate the descriptor as a regular file, check the canonical parent against the pinned trust root, and recheck
path/descriptor identity before reading bounded bytes. Ordinary leaf replacements and observed symlinked ancestors
are rejected. These portable Node checks are snapshots, not an atomic directory walk: without descriptor-relative
`openat`/`openat2` traversal, a concurrent local process renaming parent directories can still race them. Do not treat
an arbitrarily mutable source tree as a filesystem sandbox; the console remains single-user (T10).

Transcript history resolves session IDs exclusively through committed ingestion checkpoints and validated session
headers, never by constructing a path from request input or walking a browser-supplied directory. Duplicate valid
headers claiming one ID fail closed. Each batch reopens through the same boundary and validates identity, saved
head fingerprint and captured size, and rejects multiply linked files. Disappearance, replacement, truncation and detectable rewrites invalidate
history; a truncate-and-regrow entirely between observations remains subject to the filesystem limitations above.
Reads capture EOF, yield between bounded chunks and retain O(limit) window rows plus bounded I/O buffers.
Only byte-offset hints (32 LRU entries) are cached; bodies are re-read and read-time redaction remains authoritative,
including after a cache hit or daemon restart. Two scans may run concurrently with at most eight waiters; excess
requests get a generic 503. Metadata associations are bounded by the checkpoint set. No raw transcript bodies are
stored in projections, SQLite or SSE deltas.

## Specs required

Every milestone includes hostile-case specs: wrong or missing token, wrong Host, foreign Origin (also on SSE and WebSocket), query tokens or former cookies attempting reads and SSE, missing CSRF header, read-only token attempting a command, forged extension connect, oversized and malformed frames, a transcript containing terminal escape sequences and script tags, a fixture with known secret shapes, a scan failure (must withhold), and a replayed intervention (must not run twice).

## Reporting

Pre-publication, report issues privately to the repository owner. A public security contact is set before the first release.
