# Contributing

## Setup and checks

Use Node.js 26 (`.nvmrc` and CI); `engines.node` requires Node >=26. Use the npm shipped with Node. From the repository root:

```sh
npm ci
npm run gate
```

To try the web console with isolated synthetic data after `npm ci`:

```sh
npm run console
```

This builds the web client and starts the demo daemon. Open the printed one-click login link, or add `-- --open` to launch your browser (best effort). Use `npm run console -- --tui` for the terminal demo. Live samples run for 15 minutes with a fixed event budget. Ctrl-C stops the daemon and removes its temporary data. `npm run demo` remains an alias for the same launcher.

The Tier 1 gate runs typechecking, lint, unit specs, spike checks, web/TUI build checks, docs links, the secret sweep and contract checks. `npm test` runs the unit specs alone. Integration specs are separate:

```sh
npm run gate:integration
```

Browser e2e tests are also separate. Provide Chromium (set `PI_CONSOLE_CHROME` to its executable if needed; the harness also detects cached macOS Playwright headless shells), then run:

```sh
npm run build -w @pi-console/web
npm run e2e -w @pi-console/web
```

## Media (manual)

Use synthetic data only; never capture live sessions or credentials. Regenerate the fixture and gallery with:

```sh
npm run generate
npm run media
```

Generation needs Chromium, `ffmpeg` and `cwebp`; VHS and `ttyd` enable the real terminal recording (otherwise the runner reports a PTY-capture fallback). Regenerate on macOS and inspect the results; byte-identical output is not promised. See the [media guide](docs/media/README.md) for browser configuration, individual shots and budgets.

Generation is not part of the gate or CI. CI only checks committed media, with no browser or encoders required:

```sh
node scripts/media/index.mjs --check
```

## Pull requests and release notes

Apply exactly one release-intent label to each PR: `major` (breaking changes), `minor` (new functionality), `patch` (fixes), or `no-release` (no release needed).

The PR description is the release note. Keep only applicable `## Added`, `## Changed`, `## Fixed`, `## Removed`, `## Security` or `## Deprecated` sections, with concise user-facing bullets ending in bare issue references such as `(#194)`. Do not add `Closes` lines, verification notes or implementation checklists to the description. The [PR template](.github/pull_request_template.md) supplies the headings.

Release notes live on [GitHub Releases](https://github.com/woksin/pi-console/releases); there is no CHANGELOG file.

Report vulnerabilities privately using the [security policy](SECURITY.md), not a public issue.
