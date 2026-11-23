# Requests and answers: derivation (Phase A)

How the console derives requests, answers and their states from session JSONL, with no intent-memory store present
([ADR-0008](adr/0008-relationship-to-intent-memory.md), Phase A). Code: `packages/core/src/requests/` (`pairing.ts`,
`origin.ts`, `derivation.ts`); specs: `derivation.test.ts`. The derivation is read-only and every derived state is labelled
as derived.

## Facts and ordering

The session adapter emits raw facts (`RequestObserved`/`AnswerObserved`/`RequestInterrupted` with `raw: true`,
`ResetOccurred`, `SessionEnded`, `SessionStarted`, `SubagentStarted`). Pairing is **per session**. Facts of a session
are ordered by `occurredAt`, then file offset, then event id, never by arrival. On every new fact the whole session is
re-derived, so the result depends only on the set of facts. A request stated more than once keeps its latest statement
in that order. The projection is `requests` version 3: its state differs from the earlier pass-through projection, so a
snapshot of that one is rebuilt from the log, never reused.

## Pairing rules

1. A prompt opens a request. It stays open until an answer arrives.
2. An answer closes **all** requests waiting at that moment (it is the answer to whatever was open when it started).
3. An abort interrupts the pending requests (`interrupted`). An abort never undoes an answer.
4. A reset (compaction, handoff) interrupts the pending requests. An answer that arrives after the reset still pairs and
   the request becomes `answered`.
5. A reset after an answer, with no prompt or abort between them, marks that answer **possibly unseen** (the session may
   have lost it at the boundary). A prompt between the answer and the reset means the answer was seen. The flag belongs
   to the final answer: if a later answer supersedes it (rule 6), the flag goes with the old one, now interim.
6. A second answer with no new prompt or abort in between supersedes the first, resets in between included; the first
   becomes an **interim** answer.
7. A session that ends with a request still waiting leaves it `unanswered`, unless a reset already cut it off: then it
   stays `interrupted` (answer loss at a reset is not hidden by the session ending).

## State machine

The rules above as one transition table; `pairing.ts` implements it and the `transitions` table in
`derivation.test.ts` has a spec per row. Per session, the walk over the ordered facts keeps two sets:

- **waiting**: requests asked and not yet closed by an answer, an abort or the session end, each with the number of
  resets since it was asked;
- **last answered**: the requests whose final answer is the most recent answer (the supersession window). Only a prompt
  or an abort closes it; a reset does not.

Waiting is non-empty only after a prompt, which empties last answered, so at most one of the two sets is non-empty.

| Fact | Waiting requests | Last answered |
|---|---|---|
| prompt | each gets `later-prompt` evidence; the new request is `open` and joins waiting | emptied: their answers were seen |
| answer, something waiting | each becomes `answered` with it (uncertain: below) and they become last answered; waiting empties | (already empty) |
| answer, nothing waiting | (none) | each: the final answer becomes interim, this one is final, possibly unseen is cleared; if empty, the answer answers nothing |
| abort | each becomes `interrupted`; waiting empties | emptied |
| reset | each becomes `interrupted` with this `resetId` and **keeps waiting** (a later answer still pairs) | each: final answer possibly unseen; the set is kept |
| session end | `open` ones become `unanswered`, `interrupted` ones stay `interrupted`; all get `session-end` evidence; waiting empties | kept |

Any number of resets in a row behave like one, except that each adds evidence and the latest sets `resetId`.
8. An answer with nothing asked yet answers nothing.
9. Facts that name a request (`requestId`, not `raw`) are taken as stated and **override** the derivation for that request
   id, and for a raw prompt of the same transcript entry. An explicit interruption never undoes an answer. This is how an
   extension, or later the intent-memory store, states what the transcript cannot show.

## Storage and startup residency

Every public request row stays resident, because every query reads them. The auxiliary session histories (ordered
observations, explicit ids, contributed request ids) that derivation needs to pair and re-derive a session are stored
per session; a long session keeps them in normalized rows rather than inline.

- **Warm start** restores the public rows and session facts but does not read normalized histories, and the daemon
  indexes raw prompt owners by streaming them, so memory at restore does not grow with that history.
- **An event** that touches a session reads back only that session (and, for an explicit move or reset, the previous
  or named owner), derives as usual, and releases the history again once the change is saved. Queries, screens and
  transcript reads never read it. Re-deriving one very large session still needs all of that session in memory.
- **Catch-up** processes the event log in slices of at most `sliceEvents` (250) events and lets timers and I/O run
  between slices. The daemon still listens only after catch-up finishes, and a single event is not interrupted.
- Not bounded: the number and size of public request rows, startup time (still linear in stored history), and
  snapshots written by older versions, which contain their histories inline.

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

## Memory review is separate from request derivation

Session memory panels in both consoles can request confirm/reject review of recorded, non-withheld proposals, only with a separate memory-control token and a ready owning interactive pi provider. This does not change Phase A pairing or the read-only Requests view. Every request requires the native human confirmation in pi; a receipt reporting approval still waits for canonical producer ingestion. Declined, conflicted, unavailable, expired or unknown requests never synthesize memory status. The ordinary read token, disabled/offline/unsupported/not-ready providers and older daemons retain exact command fallback. See [web memory review](ui-web.md#memory-review) and [TUI memory review](ui-tui.md#memory-review) for credentials, controls and progress.

## The Requests view (web and TUI)

Both clients render the same view model (`packages/viewmodels/src/requests/`): list, filters, detail and the transcript
link are shared; the clients only draw. The view is **read-only**: no actions, and no `RequestSeen` (deferred above).

- **List**: state, origin label ("Human prompt", "Launch prompt", "Unproven origin": a classification, never a claim),
  session, age, request text and the answer excerpt. "uncertain" and "possibly unseen" are shown on the row itself.
  Unproven requests never raise attention badges ([ADR-0008](adr/0008-relationship-to-intent-memory.md)).
- **Filters**: state (`[` `]`), origin (`o`), session (`S`) and text (`/`), the same shared keys in both clients; the
  active filters are always summarised in one line.
- **Detail**: full request and answer, interim (partial, not final) answers, provenance with its evidence, and the
  evidence trail (prompt, answer, reset id). Withheld text stays `[withheld]`.
- **Jump**: Enter (or the "Open in transcript" link) opens the session with the transcript scrolled to the prompt's
  entry, from the request's pointer. In the TUI the jump waits until that entry is in the loaded transcript.
- All text is rendered as text (web: no HTML injection; TUI: terminal escapes sanitised by the view model).

Until the daemon serves the derived fields, the mock daemon adds them (`packages/testkit/src/mock-daemon/requests-derived.ts`).
