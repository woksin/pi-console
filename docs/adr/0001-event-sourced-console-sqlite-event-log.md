# ADR-0001: Event-sourced console with an append-only SQLite event log

- Status: Accepted
- Date: 2026-11-20

## Context

The console must be auditable (who intervened, when, with what result), traceable (why does this screen show this), and a basis for learning from the running setup. The owner asked for an event-sourced design with SQLite on the host filesystem. Cratis Chronicle is the natural event store, but:

- Chronicle supports SQLite as a kernel storage backend (MongoDB is the default) and is single-node with SQLite [R3 §1].
- Chronicle runs as a separate kernel process (ASP.NET Core and Orleans), shipped as Docker images; no supported embedded or in-process production mode and no documented standalone binary or no-Docker service installer [R3 §1, §3].
- Measured footprint: ready in 6 to 8 s, about 320 to 425 MiB idle, 512 MiB limit OOMed, 1 GiB advised [R3 §1]; it needs TLS and encryption certificates and an admin bootstrap even locally.
- pi users have Node 22 or newer but likely neither .NET 11 nor Docker [R3 §4].
- The SQLite backend is newer and showed a dev-reset migration race in a flaky-test note [R3 §1, §7].

## Options

1. **Cratis-native default**: Arc (.NET) plus Chronicle kernel with SQLite. Best ecosystem alignment and event-sourcing features; worst install friction and footprint; two processes.
2. **TS-native**: a Node daemon with its own append-only SQLite table. Smallest footprint; event-sourcing guarantees are written by us (constraints, replay, multi-observer).
3. **Hybrid, TS-first and Chronicle-ready**: TS-native default behind an `EventLog` port, with an optional Chronicle adapter later.
4. A TypeScript event-sourcing library (Emmett). Its SQLite store is marked beta in the research and is UNVERIFIED for maturity [R6 §D]; it would add a dependency for a small amount of code.

R3's weighted matrix (judgement, install friction weighted highest): Cratis-native 42, TS-native 52, hybrid 51 of 70.

## Decision

Option 3 (hybrid).

- The daemon owns a single append-only event log in SQLite and is its only writer.
- Port `EventLog`: `append(events, expected?)`, `readFrom(seq, limit)`, `subscribe(fromSeq)`.
- `SqliteEventLog` is the default: WAL mode, `seq` integer primary key, unique idempotency key, event type and version columns, schema version table. Driver (`node:sqlite` or `better-sqlite3`) is chosen in M0 behind the port. A per-event checksum is not needed: the single writer uses SQLite's own integrity.
- A later optional `ChronicleEventLog` adapter (via the Chronicle TypeScript client) is not built in the MVP.
- Projections are pure reducers `(state, event) -> state` with no I/O, so they can run on either engine and be replayed in tests.
- Rejected for now as the default: Cratis-native, because of install friction for a Node-based tool. Revisit when Chronicle ships a no-Docker distribution.

## Consequences

- Install is `npm` only; footprint is a Node process (about 50 to 150 MiB, UNVERIFIED estimate [R3 §4]).
- We own replay, checkpointing, ordering and schema evolution ([event model](../event-model.md)); this is a few hundred lines but must be tested thoroughly.
- Every intervention is an event, so the log is the audit trail ([ADR-0006](0006-security-model.md)).
- The port keeps a path to Chronicle; the cost is a second adapter and a conformance test suite run against both.
- Event types live in a shared package so a future Chronicle contract can be generated from them.
