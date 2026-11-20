# ADR-0008: Relationship to the intent-memory store

- Status: Accepted
- Date: 2026-11-20

## Context

The context-memory study decided that long-lived intent belongs in a source-owned store with provenance, not in model-written summaries. Its contract (v1, being implemented in the context-budget package) defines, under a store directory (`~/.pi/agent/memory`, overridable):

- `journal/<sessionId>.jsonl`: every message with its origin (human, unattended, launch, injected), verbatim redacted text or a withheld marker.
- `answers/<sessionId>.jsonl`: the assistant's answers, with final answers always kept.
- `events.jsonl`: directive and request events including boundary events (one per reset) that list the requests open at that moment.
- Invariants: a directive is a human's verbatim text; nothing human is silently dropped and no asked-for answer is lost; fail closed on secrets.

The store does not exist yet. Record schema versions differ between research notes (the answers record is `memory.answer/1` in the data-source inventory and `/2` in the contract text); the contract text is authoritative and the reader must check the schema field. Until the store exists, the same facts can be derived from session JSONL, where every human-typed prompt and the assistant's reply are present [R4 §S1].

## Options

1. The console keeps its own request and directive store.
2. The console derives requests and answers from session JSONL now and switches to the intent-memory store when present.
3. Wait for the store before building the view.

## Decision

Option 2. The console never invents a parallel intent store.

- **Phase A (no store):** derive requests from session JSONL. A request is a human-origin user message (excluding injected and subagent-launch prompts; the discrimination rules follow R4's main versus subagent signals and the extension's origin where available). Its answer is the assistant's final message for that prompt. A request whose run ended at a compaction or abort before a final answer is marked **interrupted**; one with no later assistant message is **unanswered**. A reset directly after an answer marks it **answer possibly unseen**. These derived states are clearly labelled as derived.
- **Phase B (store present):** feature-detect the store directory and tail `journal/`, `answers/` and `events.jsonl` (skipping torn or checksum-failed lines as the contract requires). Requests, answers and boundaries then come from the store, and the derived Phase A projection is kept only as a cross-check and for sessions before the store existed.
- Events carry a `derivedFrom` marker (`session-jsonl` or `intent-memory`) so projections and the UI can show provenance.
- The console **does not write** intent items in the MVP. "Mark resolved" in the console is a later feature that must go through the store's authorised path (a `request_close` event through the store's own interface); until then the console offers display-only "seen" state stored in its own event log and clearly labelled as such.
- Coordinate schema changes with the owners of the contract; the console is a reader and adapts to schema versions rather than extending the contract.

## Consequences

- The never-lost view works immediately for existing and past sessions, with approximate matching in Phase A (a prompt typed while an earlier one streams, or a retry, can be paired imperfectly; the UI shows the pairing evidence).
- Switching to the store improves precision (explicit boundary events and open-request sets) without changing the UI.
- Two derivations must be tested against the same fixtures so the switch does not change meaning.
- The console must handle a store that appears mid-life: from first detection it ingests from the beginning of the store and reconciles with Phase A results by session and message id.
