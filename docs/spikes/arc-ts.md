# M0: Arc.TypeScript end to end

## Question and decision

Can Arc.TypeScript 1.0 host a command, query and live SSE observable query, generate typed proxies, and connect them to React without a custom transport? **Works at the prototype level.** Keep Arc for M1; the plain-Hono/hand-written-SSE fallback was not needed. Actual browser DOM interaction remains a manual check, not automated browser coverage.

## Built and reproduced

`spikes/arc-ts` is a standalone npm package (no root workspace). `npm ci && npm start` in that directory builds the TypeScript Hono server and Vite React page, then serves both at `http://127.0.0.1:3000`. Its README contains setup, dev-server and persistence options.

A decorated `AddRow` command inserts a SQLite row through Drizzle and notifies the mapped table. `RowQueries.all` observes `DrizzleReadModels<Row>`. `npm run generate` produces committed `AddRow`, `All` and `Row` client artifacts and their barrel; the React page uses the generated hooks. The provider explicitly selects **direct SSE**, not the default query-hub/WebSocket path. This is a read-model demonstration, not the console event log/projector implementation.

Pinned tested combination: Node **26.8.1**, server `@cratis/arc.core`, `@cratis/arc.hono`, `@cratis/arc.drizzle`, generator **1.0.0**; browser `@cratis/arc` and `@cratis/arc.react` **22.45.0**; fundamentals **7.19.6**; Hono **4.13.19**; node-server **1.19.19**; Drizzle **0.45.4**; better-sqlite3 **13.2.0**; React **19.2.4**; TypeScript **5.9.3**; Vite **8.3.8**. No local Arc checkout/link/fork is used.

## Results and problems

The automated test starts the real compiled server, fetches the built HTML, verifies an empty query snapshot and initial SSE frame, posts the generated command's route, and asserts the expected row arrives on that **existing connection within 2 seconds**. It verifies the subsequent snapshot as well. First passing run: **27.2 ms** command-to-SSE; final aggregate gate: **9.8 ms**. These are single observations, not latency percentiles. Client typechecking and production bundling passed; browser DOM behavior was not independently executed.

- npm's script policy initially reported `better-sqlite3@13.2.0` installation scripts blocked. Both spike packages now explicitly approve that exact dependency; native rebuild succeeded. Optional fsevents was not required.
- Server entry-point setup initially used `hosted.listener`; TypeScript correctly failed with `TS2339: Property 'listener' does not exist`. The published Hono adapter returns **`hosted.server`**. Its public API works without a patch.
- Decorated server sources need legacy decorators and emitted metadata. Generated client models also need legacy decorator handling. Proxy generation uses absolute paths to avoid CWD-dependent CLI path resolution; regeneration reported **0 changed files** in the final gate.
- Observation is explicitly **in-process**: `notifyChanged(rows)` is required after committed changes. External writers do not trigger live updates automatically. The SSE transport is not a durable event subscription.
- Expected startup warning: `Arc discovery endpoints are not mapped because authentication is not configured.` Introspection was not enabled anonymously to suppress it.
- `npm audit` exits **1**: three moderate dependency entries for **GHSA-rmxm-3fg6-px4f**, node-server static-path double decoding. Arc's adapter currently depends on the affected 1.x line; fix is in 2.1.3. No override/fork was attempted. Drizzle's initial 0.45.1 SQL-identifier advisory was resolved by pinning 0.45.4. This unauthenticated, loopback-only spike is **not production-ready**.

M1 must wire commands to the application-owned event-log port/projectors, invalidate after projection commit, and test stream disconnect/reconnect, authentication and blocking SQLite work. Hub/WebSocket behavior and arbitrary package-version combinations remain unverified.

## Checks

From repository root, the requested standalone check is:

```sh
~/.pi/agent/bin/pi-phase run --kind test --policy direct --label m0-arc-check --timeout 180 -- npm --prefix spikes/arc-ts test
```

The final aggregate **Tier 1 + Tier 2** gate also passed (exit 0):

```sh
~/.pi/agent/bin/pi-phase run --kind test --policy direct --label m0-final-tier1-tier2 --timeout 300 -- sh .ai-work/m0-gate.sh
```

That local, untracked gate regenerates and checks proxies, builds both standalone packages, runs strict/unused-symbol TypeScript checks, JS syntax checks and git whitespace checks, all eight event-log contracts, then the live Hono/SQLite/SSE integration test. There is no repository CI configuration or formatter/linter to mirror; these are the available static checks, not a claim of a missing CI job passing. See the SQLite spike for Code Health scores and benchmark evidence.
