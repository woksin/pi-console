# ADR-0010: Daemon HTTP on plain `node:http` (ADR-0002 fallback)

- Status: Accepted
- Date: 2026-11-20
- Amends: [ADR-0002](0002-web-stack-node-arc-typescript-react.md) (daemon side only)

## Context

ADR-0002 chose Arc for TypeScript for the daemon and named a fallback: plain HTTP with the same shapes if Arc did not fit. Building the M1 daemon (P1) showed three problems with Arc for this daemon:

- The web UI, the TUI and the testkit mock daemon already speak the plain v0/v1 shapes in [api/v1.md](../api/v1.md): JSON collections and one SSE stream with `{seq, type, occurredAt, payload}` frames.
- Arc's observable queries over SSE have no sequence-numbered resume. The console needs `Last-Event-ID` resume from a bounded replay ring so a reconnecting client gets the deltas it missed, or a fresh snapshot.
- Arc's TypeScript packages use legacy decorators. The repository runs strip-only TypeScript on Node (no build step), which cannot execute them.

## Decision

The daemon serves API v1 with `node:http` and no web framework:

- Routes, security checks and static files are small modules in `packages/daemon` ([api/v1.md](../api/v1.md)).
- SSE follows the v0 design: contiguous ids, a 10,000-delta replay ring, `Last-Event-ID` resume, a snapshot when the id is older than the ring.
- Read models stay in memory in the projector; projection snapshots are stored in the same `node:sqlite` file as the event log (ADR-0001). No Drizzle and no `better-sqlite3`.
- The HTTP shapes are the ones ADR-0002 would have produced from the same read models, so the decision can be revisited without changing clients.

The web UI keeps React (ADR-0002); only `@cratis/arc.*` on the daemon and the generated Arc proxies are dropped. Clients use the types generated from `docs/api/schemas/api.json` (`packages/contract`).

## Consequences

- No framework dependency in the daemon: the attack surface is `node:http` plus a few hundred lines that the API conformance suite covers. The suite runs unchanged against the mock and the real daemon.
- Security headers, Host/Origin checks, token handling and CSP are hand-written and need their own specs (`packages/daemon/src/**/*.test.ts`).
- Arc alignment (generated proxies, observable queries) is deferred. A later move to Arc, or to .NET Arc with Chronicle, has to keep `Last-Event-ID` resume or provide an equivalent.
