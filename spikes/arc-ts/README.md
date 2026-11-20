# M0 — Arc.TypeScript / React / SQLite live-query spike

**Decision: pass for the single-process M1 shape; not a production scaffold.** Published Arc packages suffice: no local Arc checkout, patch, `npm link`, or fork is needed. The server uses `@cratis/arc.core`, the Hono adapter, Drizzle SQLite read models and in-process observation. The React page uses **generated** `AddRow.use()` / `All.use()` hooks, not hand-written fetches or a substitute subscription framework.

## Reproduce

Tested on macOS arm64, Apple M4 Pro, Node **v26.8.1**, npm, with exact versions and lockfile committed. Use that Node version to reproduce; other Node versions/platforms were not tested. Native `better-sqlite3` needs a working compiler/toolchain when no matching prebuild exists.

```sh
cd spikes/arc-ts
npm ci
npm run generate       # deterministic committed proxies under client/generated/
npm test               # strict TS server/client, production Vite bundle, live HTTP/SSE test
npm start              # build + serve http://127.0.0.1:3000
```

Open the page, enter a title and press **Append row**. The list is driven by the generated observable query and updates without navigation/reload. Open a second tab to see the same live update. Default database is in memory; `DATABASE=./rows.sqlite npm start` enables persistence. `PORT` defaults to 3000; binding is loopback only. For Vite HMR: run `npm start` in one terminal, `npx vite` in another (the pinned local Vite is already installed); the config proxies `/api` and `/.cratis` to port 3000. Do not change the backend port without changing that dev proxy.

On npm versions enforcing lifecycle-script approval, the package explicitly permits only `better-sqlite3@13.2.0`. If an older installation skipped its build, `npm rebuild better-sqlite3` repairs it. Optional `fsevents` was not approved or needed.

## What was demonstrated

- Decorated server artifacts discovered from the compiled `Features` directory; ordinary command and query metadata produce routable endpoints.
- `POST /api/add-row` inserts a row through Drizzle and calls **`notifyChanged(rows)`** after successful insertion. This notification is necessary; raw/native writes do not magically invalidate a read model.
- `GET /api/all` produces an initial snapshot; the same URL with `Accept: text/event-stream` streams query results. `DrizzleObservation.InProcess` re-runs the mapped query on notification.
- The React `Arc` provider explicitly selects **direct SSE** (`queryDirectMode`, `QueryTransportMethod.ServerSentEvents`). This intentionally avoids the default query hub/WebSocket path; WebSockets, hub multiplexing and reconnect behavior were not evaluated.
- `npm run generate` invokes the published proxy-generator CLI using absolute paths (the CLI is CWD-sensitive). It emits typed `AddRow`, `All`, `Row` artifacts and their barrel; query-result behavior comes from the client framework. Generated outputs are committed verbatim; consumers import those classes.
- `npm test` launches the real compiled Hono server on an OS-assigned port, fetches the built page, asserts the initial empty snapshot and SSE frame, posts the command, then asserts the matching row arrives on the **already-open** SSE connection in **<2 seconds**. It also verifies the subsequent snapshot. Observed command-to-SSE time: **27.2 ms** in the first passing run (not a latency percentile).

The automated assertion exercises HTTP/SSE and production bundling, **not a browser DOM**. The page's actual visual behavior is supplied for the manual check above; no headless browser was available/run. There is no claim of browser E2E coverage.

## M1 implications / gaps

Use Arc to expose commands/observable read models, but keep the event log as an application-owned port. This spike deliberately writes a tiny read model directly; it does **not** implement console commands, event append/projector wiring, authorization, tenancy, migrations or projection rebuilds. In M1, publish invalidations **after** committing projected state, and coalesce them at transaction/batch boundaries.

In-process observation only sees writes followed by a notification in this process. Other processes and external SQL writers need an explicit invalidation strategy; Drizzle query re-execution is not durable event delivery. Long-running streams need disconnect/reconnect and cancellation tests before adoption beyond this spike. A synchronous SQLite adapter still blocks the Node event loop during its batch.

The browser `@cratis/arc` and `@cratis/arc.react` packages use a different release train (22.45.0) than the server packages (1.0.0). The pinned combination compiled and passed the wire test; do not assume arbitrary version combinations are compatible. Server decorators require legacy TypeScript decorator/metadata settings; the client config must also retain legacy decorators for generated `@field` metadata. `reflect-metadata` is imported by the browser entry point.

**Security limitation:** `npm audit` reports three moderate entries from one upstream `@hono/node-server` static-path double-decoding advisory, propagated through `@hono/node-ws` / `@cratis/arc.hono` (GHSA-rmxm-3fg6-px4f). Arc's current dependency line uses node-server 1.x; the advisory is fixed in 2.1.3. No override/fork was attempted. Do not expose this unauthenticated spike on a network; resolve/update that adapter dependency before production. Arc also warns that discovery/introspection is not exposed without authentication; that warning is expected here. Drizzle was pinned to patched 0.45.4 after checking audit.

No repository-wide CI, formatter or linter exists yet. Strict TypeScript plus unused-symbol checks, `node --check` on the JS entry/test, production bundling and `git diff --check` are the available static checks. Generated files are not manually refactored.
