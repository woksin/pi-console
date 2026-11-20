import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { EventLog } from './event-log.ts';
import { JsonlTailer, type PollResult } from './tailer.ts';

function drain(tailer: JsonlTailer, files: string[]) {
    let entries = 0;
    let added = 0;
    let last: PollResult;
    for (let poll = 0; poll < 100; poll++) {
        last = tailer.poll(files);
        entries += last.entries;
        added += last.added;
        if (last.lagBytes === 0 || last.entries === 0) {
            return { entries, added, lagBytes: last.lagBytes, partialFiles: last.partialFiles };
        }
    }
    throw new Error('Probe did not catch up within its bounded poll budget');
}

function measure(log: EventLog, source: string, files: string[]) {
    const tailer = new JsonlTailer(log, source);
    const started = performance.now();
    const before = log.count();
    try {
        const result = drain(tailer, files);
        return { source, files: files.length, ...result, events: log.count() - before,
            elapsedMs: Math.round(performance.now() - started) };
    } finally { tailer.close(); }
}

function replay(log: EventLog, source: string, files: string[]) {
    const tailer = new JsonlTailer(log, source, { replay: true });
    try { return drain(tailer, files); }
    finally { tailer.close(); }
}

// Only the copy is rotated or truncated. No writer ever touches a real source.
function rotateCopy(session: string, output: string) {
    const copy = join(output, 'copy.jsonl');
    const archive = join(output, 'copy-20261120T120000000Z.jsonl');
    copyFileSync(session, copy);
    chmodSync(copy, 0o600);
    const log = new EventLog(join(output, 'copy.sqlite'));
    const tailer = new JsonlTailer(log, 'copy');
    try {
        const baseline = drain(tailer, [copy]);
        assert.equal(baseline.partialFiles, 0, 'Select a session with no unfinished last line');
        appendFileSync(copy, '{"synthetic":');
        assert.equal(tailer.poll([copy]).added, 0);
        renameSync(copy, archive);
        writeFileSync(copy, '{"synthetic":2}\n', { mode: 0o600 });
        assert.equal(tailer.poll([copy]).added, 1);
        appendFileSync(archive, '1}\n');
        assert.equal(drain(tailer, [archive, copy]).added, 1);
        const keys = log.keys();
        assert.equal(replay(log, 'copy', [archive, copy]).added, 0);
        assert.deepEqual(log.keys(), keys);
        writeFileSync(copy, '{}\n'); // Observed size drop on the same inode.
        assert.equal(tailer.poll([archive, copy]).added, 1);
        return { baselineEntries: baseline.entries, rotationEvents: 2, truncationEvents: 1,
            replayAdded: 0, keys: log.count() };
    } finally {
        tailer.close();
        log.close();
    }
}

function main(): void {
    process.umask(0o077);
    const [session, contextDir, requestedOutput] = process.argv.slice(2);
    if (!session || !contextDir || !requestedOutput) {
        throw new Error('Usage: probe.ts SESSION_JSONL CONTEXT_DIRECTORY .ai-work/OUTPUT');
    }
    const root = resolve(requestedOutput);
    if (!root.startsWith(resolve('.ai-work') + sep)) throw new Error('Output must be under local .ai-work');
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const output = mkdtempSync(join(root, 'probe-'));
    const contextFiles = readdirSync(contextDir).filter(name =>
        /^(events|turns)(?:-[0-9TZ-]+)?\.jsonl$/.test(name)).sort().map(name => join(contextDir, name));
    assert.ok(contextFiles.length, 'No context-budget event files found');
    const log = new EventLog(join(output, 'real.sqlite'));
    try {
        const sessionResult = measure(log, 'session-jsonl', [session]);
        const contextResult = measure(log, 'context-budget', contextFiles);
        const sessionReplay = replay(log, 'session-jsonl', [session]);
        const keys = log.keys();
        console.log(JSON.stringify({ session: sessionResult, context: contextResult,
            sessionReplay, totalEvents: log.count(), uniqueKeys: new Set(keys).size,
            copyRotation: rotateCopy(session, output) }));
    } finally { log.close(); }
}

try { main(); }
catch {
    // JSON parse errors, scanners and SQLite errors must never dump source bodies.
    console.error('Ingestion probe failed; source content withheld. Check paths and complete-line input.');
    process.exitCode = 1;
}
