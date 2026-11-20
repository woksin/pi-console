# pi-console documentation

Design documents for pi-console (status: design, name provisional). Read in this order:

1. [Vision](vision.md): the problem, the product, personas, non-goals.
2. [Information architecture](information-architecture.md): what the user sees, in web and TUI.
3. [Event model](event-model.md): the events everything is derived from.
4. [Architecture](architecture.md): components, process model, packages, budgets, testing.
5. [Security](security.md): threat model and controls.
6. [Milestones](milestones.md): M0 to M5 and the MVP slice list.
7. [Research summary](research-summary.md): evidence behind the decisions.

## Architecture decision records

| ADR | Title |
|---|---|
| [0001](adr/0001-event-sourced-console-sqlite-event-log.md) | Event-sourced console with an append-only SQLite event log |
| [0002](adr/0002-web-stack-node-arc-typescript-react.md) | Web stack: Node daemon, Arc for TypeScript, React |
| [0003](adr/0003-tui-stack-bake-off.md) | TUI stack (Proposed; decided by a visual bake-off in M0) |
| [0004](adr/0004-ingestion-tailers-over-existing-files.md) | Ingestion: tailers over existing files first |
| [0005](adr/0005-live-session-integration-via-pi-extension.md) | Live session integration through an outbound pi extension |
| [0006](adr/0006-security-model.md) | Security model |
| [0007](adr/0007-mcp-server-and-direct-adapter.md) | MCP server and Direct adapter |
| [0008](adr/0008-relationship-to-intent-memory.md) | Relationship to the intent-memory store |
| [0009](adr/0009-packaging-and-distribution.md) | Packaging and distribution |

## Conventions

- Source references such as `[R4 §S1]` point to the research summary ([research-summary.md](research-summary.md)): R1 prior-art UX, R2 TUI stack, R3 web stack, R4 data sources, R5 integration, R6 web facts. "Contract" means the intent-memory store contract v1 and "study" means the context-memory study that produced it.
- Claims marked **UNVERIFIED** were not confirmed from a source in the research.
- `~/.pi/agent` is written as `A` only in tables; paths are generic and not tied to one machine.
