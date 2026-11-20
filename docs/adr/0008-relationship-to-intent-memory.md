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

The contract cited here is intent-memory contract **v1.2** (§10: requests, answers and boundary records); §2 origin classes and the state **answer possibly unseen** (an answer that a later boundary shows as not yet seen by the session) follow it. Until `memory.requests` ships, the console uses the Phase A derivation below.

Option 2. The console never invents a parallel intent store.

- **Origin is proven, never assumed.** The contract (§2) classifies origin by positive evidence with default deny: `human` only when the harness reports interactive input, the session has a UI, it is not a child session and the text is not a launch, relaunch or synthetic prompt. Ordinary user messages in session JSONL carry no origin, and extensions inject user messages into primary sessions (lane inbox, recovery prompts), so JSONL alone cannot prove a prompt is human.
- **Phase A (no store):** derive requests from session JSONL with three origin classes. `human` is used only when the `pi-console` extension (or another recorded signal) supplies positive evidence for that prompt. `launch` marks the first prompt supplied at process start (CLI argument or file; not a relaunch); it is a request that needs an answer but is shown as "initial prompt", never as the user's words and never directive-eligible. Everything else is `unproven` and shown as "prompt (origin not verified)", never labelled "you"; unattended and injected messages are likewise labelled, not promoted. Excluding subagent sessions uses R4's main versus subagent signals. A request's answer is the assistant's final message for that prompt (latest `final` with at least 256 bytes of text, else latest `final`, else latest interim, as in contract §10.2).
  Open requests in Phase A are `human` plus `launch` (non-relaunch); `unproven` prompts appear in the Requests view with their label but do not raise "Needs you" badges until proven. A request whose run ended at a compaction or abort before a final answer is marked **interrupted**; one with no later assistant message is **unanswered**. A reset directly after an answer marks it **answer possibly unseen**. These derived states are clearly labelled as derived.
- **Phase B (store present):** feature-detect the store directory and tail `journal/`, `answers/`, `events.jsonl` and `blobs/` as the reader guide (contract §10.5) specifies: split on newline, skip blank, unparsable and crc-mismatch lines, dedup by `id`, never write or lock, tail by offset and ignore an incomplete last line.
  - Requests = journal entries with `origin=human`, plus `origin=launch` with `injectedKind != relaunch`, minus those with an applied `request_close`. Cut off = open requests listed in some boundary's `openRequests`. Answer possibly unseen = some boundary has `lastAnswerId` equal to the answer id and `sameRunAsAnswer`.
  - **idSets** (answers' `requests`, boundaries' `openRequests`) are inline when 32 ids or fewer; larger sets carry `count`, `sha256` and a blob name. The reader loads `blobs/<sha256>.txt`, verifies the hash of the sorted newline-joined ids, and otherwise treats the set as `unresolved(count)`: it shows the count only and never guesses membership. A request whose cut-off status depends on an unresolved set is shown as "possibly cut off".
  - `request_close` events fold in log order, one request per event. `answered` is honoured only when it names an `answerId` that exists, and a closure naming a missing answer is ignored and counted. `abandoned` shows who closed it (human UI command or agent citation).
  - Records with `text: null` carry `withheld`; the UI shows the gap, not an empty string.
  - Required tests: more than 32 open requests at a boundary (blob path), a missing blob, a corrupt blob (hash mismatch), a crc-mismatch line, a torn tail, and a console restarted between an answer and its boundary (shows delivered, then flips to possibly unseen).
  - The derived Phase A projection is kept only as a cross-check and for sessions before the store existed.
- Events carry a `derivedFrom` marker (`session-jsonl` or `intent-memory`) so projections and the UI can show provenance.
- The console **does not write** intent items in the MVP. "Mark resolved" in the console is a later feature that must go through the store's authorised path (a `request_close` event through the store's own interface); until then the console offers display-only "seen" state stored in its own event log and clearly labelled as such.
- Coordinate schema changes with the owners of the contract; the console is a reader and adapts to schema versions rather than extending the contract.

## Consequences

- The never-lost view works immediately for existing and past sessions, with approximate matching in Phase A (a prompt typed while an earlier one streams, or a retry, can be paired imperfectly; the UI shows the pairing evidence).
- Switching to the store improves precision (explicit boundary events and open-request sets) without changing the UI.
- Two derivations must be tested against the same fixtures so the switch does not change meaning.
- The console must handle a store that appears mid-life: from first detection it ingests from the beginning of the store and reconciles with Phase A results by session and message id.
