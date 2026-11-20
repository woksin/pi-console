# Ingestion transport (P2 foundation, not the complete MVP adapter set)

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

This is transport plus secret-sweep activation, not a claim that S1/S2/S4/S5/S8/
S9/S10/S11/S13 are implemented. Concrete source-version fixtures and paths are
not recorded in `docs/research-summary.md` (notably S5/S11); the shared catalogue
also has no agreed P5 raw observed-message seam. Source-specific mappers,
atomic-rename JSON snapshots, context downsampling, supervisor health/intervals,
real-week-copy probe and real-process transaction-kill evidence remain pending
those contracts. No real pi source content is included here.
