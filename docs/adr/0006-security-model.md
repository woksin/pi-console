# ADR-0006: Security model

- Status: Accepted
- Date: 2026-11-20

## Context

A localhost web UI that can steer AI agents that run shell commands is a high-value target. Local browser attacks (DNS rebinding, cross-site requests to localhost), other local users, and remote exposure all matter. Research summary [R3 §5, R6 §C]:

- A loopback bind alone does not stop DNS rebinding; validate `Host` against an allowlist and require authentication (OWASP).
- Jupyter uses a random token on by default, exchanged for a cookie; Syncthing binds to loopback, checks the host, and uses a CSRF header; Ollama's guidance is that CORS is not authentication.
- Remote access should go through a tailnet (Tailscale Serve) or a TLS reverse proxy with an explicit trusted-proxy list, not a public tunnel.
- Interventions as events give a built-in audit trail.

## Options

1. No auth on localhost.
2. Token on every request, loopback only, remote not supported.
3. Token plus browser protections, loopback default, remote by explicit opt-in with a documented front door, stronger auth for self-host.

## Decision

Option 3.

1. Bind `127.0.0.1` by default. Never `0.0.0.0` by default.
2. A per-install 256-bit random token in a 0600 file under the data directory; constant-time compare; `pi-console token` shows, rotates and creates scoped tokens.
3. Browser login: `?token=` is exchanged once for an HttpOnly, SameSite=Strict cookie and then removed from the URL.
4. **Host allowlist** on every request (DNS rebinding), configurable for remote hostnames.
5. **Origin check** on every state-changing request and on SSE and WebSocket upgrades.
6. **CSRF header** required on state-changing requests from the browser.
7. **No permissive CORS.** No wildcard.
8. **Scopes**: a read-only token and a control token. The TUI and MCP clients receive the scope they need. The extension channel uses its own secret ([ADR-0005](0005-live-session-integration-via-pi-extension.md)).
9. **Remote access** is off by default and enabled only by explicit opt-in: Tailscale Serve (tailnet-only) or a TLS reverse proxy with a configured trusted-proxy list for forwarded headers. Tailscale Funnel (public) is documented as not recommended.
10. **Self-host auth** (milestone M3): passkeys (WebAuthn) or OIDC with a single-owner allowlist, in addition to tokens for machine clients.
11. **Interventions**: rate limited, destructive ones (abort, multi-session actions) need typed confirmation, every one recorded as an event with actor, origin, token id and result.
12. **Secrets**: ingestion redacts and fails closed; credential files are never read; tool output is not exposed beyond what the token's scope allows.
13. **Untrusted content**: transcripts, messages and question bodies are untrusted; Markdown is sanitised and terminal control sequences are stripped before display in either front end.

Details and the threat model are in [security.md](../security.md).

## Consequences

- Some friction: first open needs the token (handled by `pi-console open`).
- Reverse proxy setups need explicit Host and trusted-proxy configuration.
- The security model is part of every API and every milestone's acceptance criteria, not a later hardening step.
- Remaining risks: same-user local processes can read the token file (same trust level as pi itself); a compromised extension or pi session can feed hostile content into the console.
