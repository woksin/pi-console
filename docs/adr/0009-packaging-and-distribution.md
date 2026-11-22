# ADR-0009: Packaging and distribution

- Status: Accepted (name provisional)
- Date: 2026-11-20

## Context

The console should be easy for an open-source adopter to install and for the owner to run as a background service. M1 requires Node 26 or newer (`node:sqlite`, and the OpenTUI FFI runtime from [ADR-0003](0003-tui-stack-bake-off.md)); pi users have Node 22 or newer today, so the console states the higher floor at install. The TUI language is not decided ([ADR-0003](0003-tui-stack-bake-off.md)); the pi extension is installed through pi's package mechanism, and local packages are registered in pi's settings [R4].

## Options

1. Several independent npm packages.
2. An npm workspace monorepo that publishes one CLI package plus the extension package.
3. A single native binary (only possible if the daemon is rewritten; not considered).

## Decision

Option 2.

- npm workspace monorepo (packages listed in [architecture](../architecture.md#package-layout)).
- One published CLI package `pi-console` with subcommands: `daemon`, `tui`, `install-service` (launchd and systemd units generated; Windows guidance), `token`. There is no `open` subcommand: the daemon prints the launch link at startup instead. `install-service` is planned, not implemented yet; configure launchd or systemd yourself to supervise `pi-console daemon` in the meantime. The web UI is built to static assets bundled into the package and served by the daemon.
- A second published package for the pi extension, installable with pi's package mechanism.
- If the TUI bake-off selects a non-TypeScript stack, the TUI ships as a separate binary (release assets, Homebrew) and `pi-console tui` locates or downloads it; the daemon and web UI remain in the npm package.
- If the TUI needs a runtime other than the Node 26 floor (for example Bun), `pi-console tui` checks for it and prints the requirement.
- The name `pi-console` is provisional. No public repository, npm publication or domain is created until the owner approves name and visibility.
- Versioning: semantic versioning, one version for all workspace packages; the event schema version and the daemon API version are tracked separately and documented.

## Consequences

- `npm install -g pi-console` is the whole install for the default path.
- Releasing two packages (and possibly a binary) needs a small release workflow.
- Name changes before publication are cheap; after publication they are not.
