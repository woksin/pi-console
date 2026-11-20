# Security

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
- **Acceptance:** accepted by the owner (Q-378 delegation) for the TUI process. Status: **pending first-release verification**, until the Linux install and runtime interaction test passes (P4).

## Remote access

Supported only through (a) Tailscale Serve (tailnet only) or (b) a TLS reverse proxy that you configure with an explicit Host allowlist and trusted-proxy list. Do not expose the daemon directly. Self-host authentication (passkeys or OIDC with a single-owner allowlist) arrives in M3; until then remote use relies on the tailnet or proxy and the token.

## Specs required

Every milestone includes hostile-case specs: wrong or missing token, wrong Host, foreign Origin (also on SSE and WebSocket), no Origin with cookie only, missing CSRF header, read-only token attempting a command, forged extension connect, oversized and malformed frames, a transcript containing terminal escape sequences and script tags, a fixture with known secret shapes, a scan failure (must withhold), and a replayed intervention (must not run twice).

## Reporting

Pre-publication, report issues privately to the repository owner. A public security contact is set before the first release.
