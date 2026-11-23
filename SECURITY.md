# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities privately through [GitHub Security Advisories](https://github.com/woksin/pi-console/security/advisories/new): open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue or include credentials or private session content. Include affected versions, reproduction steps and the expected security impact, with synthetic or redacted examples.

## Current security model

- **Single-user, loopback only.** The daemon binds to `127.0.0.1`, not a LAN interface. It is not a remote-access service or a sandbox against malicious code running as the same user.
- **Bearer authentication.** API requests, including SSE, require `Authorization: Bearer <token>`. The daemon creates a 256-bit random token in `<data-dir>/token` (0600) inside a private data directory (0700), reuses it on restart and checks its hash in constant time. Cookies and query-string tokens do not authenticate. To rotate, stop the daemon, delete the token file and restart. Keep credentials out of logs, issues and source control.
- **Request-source checks.** Every HTTP path, including unauthenticated static files, checks `Host` against `127.0.0.1:<port>` and `localhost:<port>`. When present, `Origin` must be the HTTP origin of one of those allowed hosts; `Sec-Fetch-Site: cross-site` is refused. These checks defend against DNS rebinding and cross-site requests, but do not replace authentication.
- **Read-only by default.** The ordinary token cannot request changes. Opt-in memory review uses a separate `memory-control-token` and an authenticated extension channel. It requests native human confirmation in pi, never writes memory directly, and does not enable answering, steering or pausing agents.

See the [threat model and controls](docs/security.md), [API security details](docs/api/v1.md#security) and [security ADR](docs/adr/0006-security-model.md).
