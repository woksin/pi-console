import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, closeSync, mkdirSync, mkdtempSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { EventLog } from './event-log.ts';
import { JsonlTailer } from './tailer.ts';
import { redact } from './redact.ts';

function fixture(t: TestContext) {
    const root = '.ai-work/tasks/m0-ingestion/output';
    mkdirSync(root, { recursive: true });
    const dir = mkdtempSync(join(root, 'spec-'));
    const file = join(dir, 'events.jsonl');
    const database = join(dir, 'events.sqlite');
    writeFileSync(file, '');
    const log = new EventLog(database);
    const tailers: JsonlTailer[] = [];
    const tail = (options = {}) => {
        const tailer = new JsonlTailer(log, 'fixture', options);
        tailers.push(tailer);
        return tailer;
    };
    t.after(() => {
        for (const tailer of tailers) tailer.close();
        log.close();
        rmSync(dir, { recursive: true }); // Only this test's freshly-created synthetic files.
    });
    return { dir, file, database, log, tail };
}
const entry = (id: number) => JSON.stringify({ id }) + '\n';

test('partial UTF-8 line is buffered at the source, including across restart', t => {
    const f = fixture(t);
    const bytes = Buffer.from('{"text":"héllo"}\n');
    const split = bytes.indexOf(0xc3) + 1;
    appendFileSync(f.file, bytes.subarray(0, split));
    const first = f.tail();
    assert.equal(first.poll([f.file]).partialFiles, 1);
    assert.equal(f.log.count(), 0);
    first.close();
    appendFileSync(f.file, bytes.subarray(split));
    assert.equal(f.tail().poll([f.file]).added, 1);
    assert.match(JSON.stringify(f.log.payloads()), /héllo/);
});

test('rename/reopen during write drains old descriptor and discovers the new inode', t => {
    const f = fixture(t);
    const writer = openSync(f.file, 'a');
    t.after(() => closeSync(writer));
    appendFileSync(writer, entry(1) + '{"id":');
    const tailer = f.tail();
    assert.equal(tailer.poll([f.file]).added, 1);
    const archive = join(f.dir, 'events-20261120T120000000Z.jsonl');
    renameSync(f.file, archive);
    writeFileSync(f.file, entry(3));
    assert.equal(tailer.poll([f.file]).added, 1);
    appendFileSync(writer, '2}\n'); // Late completion after active path has been reopened.
    assert.equal(tailer.poll([archive, f.file]).added, 1);
    assert.equal(tailer.poll([archive, f.file]).added, 0);
    assert.equal(f.log.count(), 3);
    tailer.close();
    assert.equal(f.tail().poll([archive, f.file]).added, 0);
});

test('rename/reopen entirely between polls recovers unread bytes from archive on restart', t => {
    const f = fixture(t);
    appendFileSync(f.file, entry(1));
    const tailer = f.tail();
    tailer.poll([f.file]);
    tailer.close();
    appendFileSync(f.file, entry(2));
    const archive = join(f.dir, 'events-20261120T120000000Z-001.jsonl');
    renameSync(f.file, archive);
    writeFileSync(f.file, entry(3));
    assert.equal(f.tail().poll([archive, f.file]).added, 2);
    assert.equal(f.log.count(), 3);
});

test('observed size drop starts a persistent generation, even with pending bytes', t => {
    const f = fixture(t);
    appendFileSync(f.file, entry(1) + '{"unfinished":"long pending body');
    const tailer = f.tail();
    tailer.poll([f.file]);
    const keys = f.log.keys();
    writeFileSync(f.file, entry(2)); // Same inode, offset zero must not collide.
    assert.equal(tailer.poll([f.file]).added, 1);
    assert.notEqual(f.log.keys()[1], keys[0]);
    tailer.close();
    assert.equal(f.tail().poll([f.file]).added, 0);
    assert.equal(f.log.count(), 2);
});

test('transaction failure rolls back both events and checkpoint and permits retry', t => {
    const f = fixture(t);
    appendFileSync(f.file, entry(1));
    let fail = true;
    const tailer = f.tail({ beforeCommit: () => { if (fail) throw new Error('fault'); } });
    assert.throws(() => tailer.poll([f.file]), /fault/);
    assert.equal(f.log.count(), 0);
    fail = false;
    assert.equal(tailer.poll([f.file]).added, 1);
    assert.equal(tailer.poll([f.file]).added, 0);
});

test('process crash between read and commit leaves no event or checkpoint gap', t => {
    const f = fixture(t);
    appendFileSync(f.file, entry(1) + entry(2));
    const child = spawnSync(process.execPath, ['spikes/ingestion/crash.ts', f.database, f.file]);
    assert.equal(child.status, 73);
    assert.equal(f.log.count(), 0);
    assert.equal(f.tail().poll([f.file]).added, 2);
    assert.equal(f.log.count(), 2);
});

test('replaying the same bytes twice produces identical keys and zero new rows', t => {
    const f = fixture(t);
    appendFileSync(f.file, entry(1) + entry(2));
    f.tail().poll([f.file]);
    const keys = f.log.keys();
    for (let pass = 0; pass < 2; pass++) {
        const replay = f.tail({ replay: true });
        assert.equal(replay.poll([f.file]).added, 0);
        assert.deepEqual(f.log.keys(), keys);
        replay.close();
    }
    assert.equal(new Set(keys).size, 2);
});

test('redaction masks patterns before storage and withholds text if scanning throws', t => {
    const f = fixture(t);
    appendFileSync(f.file, '{"text":"Bearer synthetic-secret-token"}\n');
    f.tail().poll([f.file]);
    assert.doesNotMatch(JSON.stringify(f.log.payloads()), /synthetic-secret-token/);
    assert.match(JSON.stringify(f.log.payloads()), /REDACTED/);
    appendFileSync(f.file, '{"password":"synthetic-private"}\n');
    f.tail({ scanner: () => { throw new Error('synthetic-private'); } }).poll([f.file]);
    assert.deepEqual((f.log.payloads()[1] as { excerpt: unknown }).excerpt, { withheld: true });
    assert.doesNotMatch(JSON.stringify(f.log.payloads()), /synthetic-private/);
    assert.deepEqual(redact('private', (() => undefined) as never), { withheld: true });
});

test('invalid complete JSON fails without advancing or exposing the input', t => {
    const f = fixture(t);
    appendFileSync(f.file, entry(1) + 'private malformed input\n');
    assert.throws(() => f.tail().poll([f.file]), /^Error: Invalid complete JSONL entry; checkpoint not advanced$/);
    assert.equal(f.log.count(), 0);
});

test('non-JSONL paths are refused', t => {
    const f = fixture(t);
    const denied = join(f.dir, 'auth.json');
    writeFileSync(denied, 'not read');
    assert.throws(() => f.tail().poll([denied]), /not an allowed JSONL/);
});
