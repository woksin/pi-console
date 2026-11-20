# ADR-0007: MCP server and Direct adapter

- Status: Accepted
- Date: 2026-11-20

## Context

Agents (pi lanes and non-pi agents) benefit from querying the console: open requests, answers, lane state, questions. Direct (the Cratis control plane) exposes an MCP server and has local runners [R5 Part A]:

- Streamable HTTP, stateless, path `/mcp`, auth by a personal access token (`Authorization: Bearer ...`) plus a tenant header; scopes include read and write; mutations need an idempotency key.
- Read tools: `direct_my_work`, `direct_events_wait` (long-poll event feed, cursor), `direct_runners_list`, `direct_work_where`, `direct_question_status`. Write: `direct_question_answer`.
- No dispatch, pause or cancel-work tool exists over MCP in the checked checkout; runner pause is only on the runner's loopback interface.
- The checked Direct checkout was stale (about 643 commits behind its remote), so the tool list must be re-verified. Several relevant Direct issues were open at the study date: #2369 (standing answers and directives), #2354 (external progress reporting), #2355 (question bridge; question tools refused for PATs pending a scope decision), #2035 (hybrid handoff and delegate), plus event feed, scoped session tokens and stateful MCP issues. The study also found no Direct MCP server, PAT or runner configured on the author's machine.

## Options

1. No MCP; agents read console files or use pi-specific tools only.
2. A console MCP server (read-mostly) and a Direct adapter that consumes Direct's MCP.
3. Proxy Direct's tools through the console.

## Decision

Option 2; option 3 is rejected.

**Console MCP server**

- Streamable HTTP on `127.0.0.1`, bearer token (read-only scope by default), stateless, mirroring Direct's design. A stdio shim is optional.
- Read tools: open requests, answer status, lane state, question list and status, recent messages.
- Writes are limited to **asking** (creating a question or raising a request for the human), never answering one: humans answer in the UI. This mirrors Direct, where agents ask and members answer.
- pi lanes keep using extension-native tools where they exist (lower token cost); MCP is for non-pi agents and for pi lanes that prefer it.

**Direct adapter (milestone M4)**

- Optional. Consumes Direct's MCP with a PAT stored in a secret store, read-only first: `direct_my_work`, `direct_events_wait`, `direct_runners_list`, `direct_work_where`, `direct_question_status`.
- `direct_question_answer` is enabled only when Direct permits PAT access to it and the console token has control scope.
- No dispatch or pause UI is built until Direct exposes it; the console does not call the runner's unstable loopback API in the MVP.
- Direct events become console events with their own source and cursor checkpoint ([event model](../event-model.md)).
- Direct is worked by many lanes; change requests to Direct go through its owners, not this repository.

## Consequences

- Agents can ask the console instead of reading files; the answer store remains the human-owned record.
- The Direct adapter's read path can ship before Direct's write paths are settled.
- The adapter must be re-verified against current Direct before M4 starts.
- Console MCP tools are a new prompt-injection surface (agent-supplied text shown to the human); see [security](../security.md).
