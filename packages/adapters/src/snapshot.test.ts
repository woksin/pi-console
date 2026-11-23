import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pollSnapshot } from './snapshot.ts';
import { laneStatusMapper } from './sources/lanes.ts';
import { questionMapper } from './sources/questions.ts';
import { MemoryLog } from './tailing/memory-log.test.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/sources.json', import.meta.url), 'utf8')).question;

test('a decode hook feeds non-JSON files to the mapper as one JSON line', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-snapshot-'));
  try {
    const path = join(root, 'L0.status');
    writeFileSync(path, 'working since 2026-11-20T09:00:00Z\n');
    const log = new MemoryLog();
    const decode = (bytes: Buffer) => JSON.stringify({ lane: 'L0', line: bytes.toString('utf8').trim() });
    assert.equal(await pollSnapshot(log, 'lane-messages', path, laneStatusMapper, { roots: [root], decode }), 1);
    assert.equal(log.rows[0].type, 'LaneStatusChanged');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('snapshots observe atomic rename and same-size rewrite, resume and redact before persistence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-snapshot-'));
  try {
    const path = join(root, 'question.json');
    const log = new MemoryLog();
    const revisions = new Map<string, number>(); // A store bumps the revision with every content change.
    const save = (text: string) => writeFileSync(path, JSON.stringify({ ...fixture, text, rev: revisions.get(text) ?? revisions.set(text, revisions.size + 1).get(text) }));
    save('First');
    assert.equal(await pollSnapshot(log, 'question-store', path, questionMapper, { roots: [root] }), 2);
    assert.equal(await pollSnapshot(log, 'question-store', path, questionMapper, { roots: [root] }), 0);
    save('Other');
    assert.equal(await pollSnapshot(log, 'question-store', path, questionMapper, { roots: [root] }), 1);
    renameSync(path, join(root, 'old.json'));
    save('Other');
    assert.equal(await pollSnapshot(log, 'question-store', path, questionMapper, { roots: [root] }), 0);
    save('Third');
    assert.equal(await pollSnapshot(log, 'question-store', path, questionMapper, { roots: [root] }), 1);
    const secret = 'ghp_' + 'x'.repeat(36);
    save(secret);
    await pollSnapshot(log, 'question-store', path, questionMapper, { roots: [root] });
    assert.ok(!JSON.stringify(log.rows).includes(secret));
    assert.ok(!JSON.stringify(log.positions).includes(secret));
    const before = readFileSync(path);
    log.failNext = true;
    save('Retry');
    await assert.rejects(pollSnapshot(log, 'question-store', path, questionMapper, { roots: [root] }), /transaction abort/);
    assert.equal(await pollSnapshot(log, 'question-store', path, questionMapper, { roots: [root] }), 1);
    assert.notDeepEqual(readFileSync(path), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a mapper version rereads unchanged content once, keeping old events and checkpoints', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-snapshot-version-'));
  try {
    const path = join(root, 'question.json');
    writeFileSync(path, JSON.stringify(fixture));
    const log = new MemoryLog();
    assert.equal(await pollSnapshot(log, 'question-store', path, () => [], { roots: [root] }), 0);
    const options = { roots: [root], mapperVersion: 'v-test' };
    assert.equal(await pollSnapshot(log, 'question-store', path, questionMapper, options), 2);
    assert.equal(await pollSnapshot(log, 'question-store', path, questionMapper, options), 0);
    assert.equal(await pollSnapshot(log, 'question-store', path, questionMapper, { roots: [root] }), 0);
    const identities = log.positions.map(position => position.identity);
    assert.equal(identities.length, 2);
    assert.deepEqual(identities.map(identity => identity.endsWith('#v-test')).sort(), [false, true]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('snapshot boundaries deny outside roots, credentials, oversize and symlink escapes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-snapshot-boundary-'));
  try {
    const path = join(root, 'question.json');
    const auth = join(root, 'auth.json');
    writeFileSync(path, JSON.stringify(fixture));
    writeFileSync(auth, '{}');
    const link = join(root, 'innocent.json');
    symlinkSync(auth, link);
    const log = new MemoryLog();
    await assert.rejects(pollSnapshot(log, 'question-store', path, questionMapper, { roots: [] }));
    await assert.rejects(pollSnapshot(log, 'question-store', path, questionMapper, { roots: [root], maxBytes: 1 }));
    await assert.rejects(pollSnapshot(log, 'question-store', link, questionMapper, { roots: [root] }));
    writeFileSync(path, '{');
    await pollSnapshot(log, 'question-store', path, questionMapper, { roots: [root] });
    assert.equal(log.rows[0].type, 'SourceSchemaUnknown');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
