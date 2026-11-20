# Requests and answers: derivation (Phase A)

How the console derives requests, answers and their states from session JSONL, with no intent-memory store present
([ADR-0008](adr/0008-relationship-to-intent-memory.md), Phase A). Code: `packages/core/src/requests/` (`pairing.ts`,
`origin.ts`, `derivation.ts`); specs: `derivation.test.ts`. The derivation is read-only and every derived state is labelled
as derived.

## Facts and ordering

The session adapter emits raw facts (`RequestObserved`/`AnswerObserved`/`RequestInterrupted` with `raw: true`,
`ResetOccurred`, `SessionEnded`, `SessionStarted`, `SubagentStarted`). Pairing is **per session**. Facts of a session
are ordered by `occurredAt`, then file offset, then event id, never by arrival. On every new fact the whole session is
re-derived, so the result depends only on the set of facts.

## Pairing rules

1. A prompt opens a request. It stays open until an answer arrives.
2. An answer closes **all** requests waiting at that moment (it is the answer to whatever was open when it started).
3. An abort interrupts the pending requests (`interrupted`). An abort never undoes an answer.
4. A reset (compaction, handoff) interrupts the pending requests. An answer that arrives after the reset still pairs and
   the request becomes `answered`.
5. A reset directly after an answer, with no prompt between them, marks that answer **possibly unseen** (the session may
   have lost it at the boundary). A prompt between the answer and the reset means the answer was seen.
6. A second answer with no new prompt in between supersedes the first; the first becomes an **interim** answer.
7. A session that ends with a request still waiting leaves it `unanswered`.
8. An answer with nothing asked yet answers nothing.
9. Facts that name a request (`requestId`, not `raw`) are taken as stated and **override** the derivation for that request
   id, and for a raw prompt of the same transcript entry. An explicit interruption never undoes an answer. This is how an
   extension, or later the intent-memory store, states what the transcript cannot show.

## Uncertain pairings

Labelled `uncertain` with a reason, and the evidence entries (prompt, later prompt, reset, answer, boundary, each with
entry id or reset id) are kept so the UI can show why:

- `shared-answer`: one answer closed more than one request.
- `reset-then-new-prompt`: a reset separated an older request from a newer prompt before the answer, so the summary may
  have lost the older one.

Pairing is approximate (a prompt typed while an earlier one streams, or a retry, can pair imperfectly); the UI shows the
evidence rather than hiding the doubt.

## Origin rules

Default deny: positive evidence or nothing. Origin is derived from **session facts only**.

- A raw prompt is never `human`. Session JSONL does not record whether text was typed, injected or queued.
- Text proves nothing: lane headers such as `[orch message from L0]` are unauthenticated claims, and a slash command in
  a transcript is not proof that a human ran it (slash commands run before pi's origin checks).
- Prompts of a subagent session are `unproven` (the parent agent wrote them).
- `launch` is only the **first** prompt of a session known to be top level: no parent link and the source established
  that fact (`SessionStarted.parentSessionKnown`). A session with a parent (fork, handoff, relaunch) or with an unknown
  parent status gets `unproven` (fail closed). Later prompts are `unproven`.
- `human` can only come from an explicit fact with positive evidence (a `pi-console` extension or the store), never from
  this derivation.

Current gap: the session adapter reports no parent link (`parentSessionId` is always null and `parentSessionKnown` is not
set), so in M1 every derived prompt is `unproven`. The sampling run confirmed it (below).

## What the views do with it

"Needs you" lists open `human` and `launch` requests; `unproven` ones appear in the Requests view with their label and do
not raise badges. Request text is one line, stripped of control sequences; withheld text is a visible gap. The detail
says "classified", never "verified".

## Trust lessons from the intent-memory study (summary)

From the CTX findings digest (not copied; the digest and the study folder stay authoritative):

- Origin is default-deny and every row shows origin and its evidence; unattended and injected text is displayed but
  visibly marked.
- Lane headers are descriptive only: label sender identity as "claimed (from message text)", never use it for permission
  or routing.
- Slash commands are not proof of a human; confirmations come from recorded events, not transcript text.
- Fail closed: unknown source means `unproven`; a missing, unverifiable or withheld piece is shown as a gap, never guessed.
- Answer loss at a reset is the user's top complaint, which is why "interrupted" and "possibly unseen" are first-class.
- The store may be absent; feature-detect and treat absence as normal. Readers never write or lock the store.

## Phase B (store present): spec list

The intent-memory store is an optional future source; the Phase A derivation stays as cross-check and for sessions from
before the store. Specs required before switching:

- More than 32 open requests at a boundary (id-set blob path).
- A missing blob (`unresolved(count)`, shown as "possibly cut off").
- A corrupt blob (hash mismatch).
- A crc-mismatch line (skipped).
- A torn tail (incomplete last line ignored until completed).
- A console restarted between an answer and its boundary (shows delivered, then flips to possibly unseen).
- A store that appears mid-life (ingest from the beginning, reconcile with Phase A by session and message id).

## Decision: `RequestSeen` is deferred

No `RequestSeen` event is introduced in M1. Nothing in session JSONL can prove that a human saw or typed a prompt, and
inventing the event now would only restate unproven facts. Revisit when the extension (ADR-0005) or the store can supply
positive evidence; explicit facts (rule 9) already give that evidence a path in.

## Sampling tool

`packages/core/tools/sample-requests.ts` runs the real pipeline over a **copy** of session files and writes a Markdown
sample for a by-hand check of the rules. It refuses the live sessions directory. Its output goes only under `.ai-work/`
and is never committed. The first sample (134 requests from 68 copied files) showed shared answers, reset-then-new-prompt
and possibly-unseen cases and, because of the adapter gap above, all requests `unproven`. The hand check of the sample is
done in P6.
