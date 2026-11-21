# Security

## Optional native memory review scope

`config.json` may opt in with `"memoryActions": true` (default false). This creates a separate 0600
`memory-control-token` in the daemon's 0700 data directory. The existing `token` remains read-only.
The control credential authorises a review request, never a claim of human presence. Control mutations require
same-Origin and `x-pi-console-csrf: 1` even with a bearer. Never place either token in URLs or logs.

Load `packages/extension/src/index.ts` with pi's extension loader (or the package's `pi.extensions` manifest),
set `PI_CONSOLE_MEMORY_REVIEW=1`, and optionally set `PI_CONSOLE_URL` (default `http://127.0.0.1:4777`) and
`PI_CONSOLE_DATA_DIR` (default `~/.pi-console`). The extension reads only its separate credential file, refuses
symlink/non-private/foreign-owned credentials, and connects outbound only to a loopback daemon.
A fresh HMAC challenge authenticates **both** peers and binds session/pid/cwd plus connection generation;
raw credentials never cross the WebSocket. Host/Origin policy also applies to upgrades. A read token cannot
answer that challenge. Neither a successful handshake nor a browser click is human provenance.

The provider must implement `context-budget:memory-review/v1:*` (pi-context-budget f0033fe); absence,
unknown versions, non-native UI, handoff, wrong store, unknown/child roles and ambiguous targets fail closed.
The provider alone reloads canonical item/source content, presents native pi confirmation and performs any write.
The extension forwards fixed-shape intent/result/cancel messages only; it cannot send commands or UI responders.
Receipt metadata is stored separately in `memory-actions.db`, without source text, prompts or credentials.
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
| T2 | Cross-site request forges a steer or abort | Origin check on state-changing and upgrade requests; CSRF header; SameSite=Strict cookie; no permissive CORS |
| T3 | Token theft | 256-bit random token; 0600 file; token removed from URL after exchange; HttpOnly cookie; rotation; scoped read-only tokens; no token in logs |
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

## Specs required

Every milestone includes hostile-case specs: wrong or missing token, wrong Host, foreign Origin (also on SSE and WebSocket), no Origin with cookie only, missing CSRF header, read-only token attempting a command, forged extension connect, oversized and malformed frames, a transcript containing terminal escape sequences and script tags, a fixture with known secret shapes, a scan failure (must withhold), and a replayed intervention (must not run twice).

## Reporting

Pre-publication, report issues privately to the repository owner. A public security contact is set before the first release.
