# Ingestion transport and session observations (partial P2)

`FileTailer` reads JSONL through read-only, no-follow descriptors. Pass a shared
`EventLog`, a source id, and a schema-guarded mapper returning catalogue facts.
The mapper must reject unsupported source versions and use stable domain ids;
it must never infer human origin. Malformed records and failed mappings become
body-free `SourceSchemaUnknown` events. Payloads and metadata are redacted before
validation and append; transcript bodies are never copied. Source refs retain
`{file, offset, entryId}`. Empty lines are skipped and torn lines re-read.

Polls are serialized and bounded to one batch per descriptor (default 1 MiB),
providing back-pressure to the caller. Await the poll before closing. Events and
complete-line checkpoints go through one `EventLog.append` transaction. The
caller owns discovery scheduling; `discover` defaults to a 14-day mtime window,
skips credential/browser/environment paths and never follows directory symlinks.
Keep the tailer alive to drain late writes to renamed files; on restart include
archives in discovery. Close releases all retained descriptors.

## Carried limitation

Size drops advance generation. **Truncate-and-regrow between polls is not
reliably detectable**: a rewrite reaching the previous size can silently hide an
epoch. A changed hash of the previously observed first (at most) 512 bytes emits
a `SourceSchemaUnknown` warning, but does not reset offsets or recover skipped
bytes. Changes beyond that prefix may be missed entirely. Normal prefix growth
on append is not a warning. The specs pin this documented missed-epoch case.

## Remaining P2 work / coordination

`sessionTailer(log, path, options)` reads a bounded v3 header to recover the
session id even after a checkpoint restart. Use one instance per logical session,
not one instance for a directory of unrelated sessions. Include renamed archives
of that session in polls. Unsupported headers and entries produce body-free
`SourceSchemaUnknown` events. The synthetic v3 fixture mirrors inspected real
record keys; no real transcript content is included.

S1 currently maps session start, model/thinking changes, compaction, user prompts,
final assistant messages (`stop`), and explicit assistant aborts (`aborted`). It
does not yet map turn, job or subagent lifecycle notifications. User-role prompts
are `unproven`: neither first position nor role proves launch provenance. Request
ids identify prompt observations; answers and aborts carry `raw: true`, sessionId
and entryId, with no fabricated requestId. Their SourceRef points to the original
entry. P5 alone derives pairing and request state. Tool calls/results are not
answers. Excerpts are redacted and bounded; full transcript bodies are not copied.

S2/S4/S5/S8/S9/S10/S11/S13, atomic-rename JSON snapshots, context downsampling,
supervisor health/intervals, the real-week probe and real-process transaction-kill
evidence remain unimplemented. This package is not yet M1/P2 complete.
