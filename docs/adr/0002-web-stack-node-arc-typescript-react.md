# ADR-0002: Web stack: Node daemon, Arc for TypeScript, React

- Status: Accepted (subject to the M0 spike)
- Amended by: [ADR-0010](0010-daemon-http-plain-node-fallback.md) (M1 daemon uses the plain-HTTP fallback)
- Date: 2026-11-20

## Context

The web UI runs on localhost as a persistent background service and can optionally be self-hosted. The owner wants it built on Cratis. Arc for TypeScript exists on npm at 1.0 with "bounded parity": core, Express, Fastify and Hono adapters, Drizzle (SQLite in-process, Postgres, MySQL), MongoDB, Chronicle and a proxy generator, with the same HTTP contract as .NET Arc [R3 §2b]. Observable queries run over SSE or WebSocket and are consumed by the React client [R3 §2b]. Caveats:

- Drizzle observation is in-process and only sees announced writes [R3 §2b]. Fine here: the daemon owns all writes.
- The core packages require Node >= 22; the Chronicle package requires Node >= 22.19 [R3 §2b].
- Cratis packages change daily [R3 §7]; Arc.TS is a new 1.0.
- Research reports disagree on whether the proxy generator is published: R3 reports `@cratis/arc.proxygenerator` 1.0.0 on npm, R6 reports a docs statement that it is not published to npm and must be built from source. Verify in M0.

## Options

1. Plain Hono or Fastify plus hand-written REST and SSE, React with a custom client.
2. Arc for TypeScript (Hono adapter, Drizzle SQLite read models, proxy generator), React with `@cratis/arc.react` and `@cratis/components`.
3. .NET Arc backend with Chronicle (see [ADR-0001](0001-event-sourced-console-sqlite-event-log.md)).

## Decision

Option 2.

- Node >= 22 daemon (22.19 if the Chronicle adapter or pi-tui is used) with `@cratis/arc.core`, `@cratis/arc.hono`, `@cratis/arc.drizzle` (SQLite read models) and `@cratis/arc.proxygenerator`.
- React UI with `@cratis/arc.react` and `@cratis/components`; observable queries over SSE.
- Keep to the Arc HTTP contract so a .NET Arc backend could replace the daemon later without changing the UI.
- Pin exact versions of every Cratis package. Milestone M0 includes a spike: Arc.TS plus Hono plus Drizzle plus an observable query over SSE end to end, with generated proxies.
- If the spike fails (generator unavailable, observable queries unreliable), fall back to option 1 with the same HTTP shapes; the read models and projections do not change.

## Consequences

- Alignment with the Cratis ecosystem and generated, typed proxies for the web client.
- Dependency on a young framework; mitigated by pinning, the spike and the fallback.
- Observable queries fan out from the single in-process projector; scaling beyond one daemon is out of scope.
- The TUI and the MCP server use the same API contract, not Arc's React client ([ADR-0003](0003-tui-stack-bake-off.md), [ADR-0007](0007-mcp-server-and-direct-adapter.md)).
