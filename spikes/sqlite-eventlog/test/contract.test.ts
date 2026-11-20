import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SqliteEventLog, connect, type Driver, type EventInput } from '../event-log.ts';

const root = fileURLToPath(new URL('../../../.ai-work/m0-sqlite-tests/', import.meta.url));
mkdirSync(root, { recursive: true });
const event = (id: string): EventInput => ({ idempotencyKey: id, type: 'Observed', version: 1,
    payload: { text: 'example' } });
const drivers: Driver[] = ['node:sqlite', 'better-sqlite3'];

for (const driver of drivers) {
    test(`${driver}: append, ordered replay, idempotency, reopen and WAL`, t => {
        const path = `${mkdtempSync(`${root}/contract-`)}/events.sqlite`;
        const log = new SqliteEventLog(driver, path);
        assert.equal(log.append([]), null);
        assert.deepEqual(log.append([event('a'), event('b')]), { first: 1, last: 2, count: 2 });
        assert.equal(log.append([event('a')]), null);
        assert.deepEqual(log.append([event('a'), event('c'), event('c')]),
            { first: 3, last: 3, count: 1 });
        assert.deepEqual(log.readFrom(0, 1), [{ ...event('a'), seq: 1 }]);
        assert.deepEqual(log.readFrom(1, 10).map(row => row.seq), [2, 3]);
        assert.deepEqual(log.readFrom(3, 10), []);
        assert.throws(() => log.readFrom(-1, 1), RangeError);
        assert.throws(() => log.readFrom(0, 0), RangeError);
        log.close();
        const reopened = new SqliteEventLog(driver, path);
        t.after(() => reopened.close());
        assert.equal(reopened.readFrom(0, 10).length, 3);
        const db = connect(driver, path);
        assert.deepEqual(db.prepare('PRAGMA journal_mode').all().map(Object.values), [['wal']]);
        assert.deepEqual(db.prepare('SELECT version FROM schema_version').all().map(Object.values), [[1]]);
        db.close();
    });

    test(`${driver}: replay then live, unsubscribe, reentrant append and failed observer isolation`, t => {
        const log = new SqliteEventLog(driver, ':memory:');
        t.after(() => log.close());
        log.append([event('a'), event('b')]);
        const received: number[] = [];
        const stop = log.subscribe(1, row => {
            received.push(row.seq);
            if (row.seq === 2) log.append([event('c')]);
        });
        assert.deepEqual(received, [2, 3]);
        log.subscribe(3, () => { throw new Error('broken observer'); });
        log.append([event('d')]);
        log.append([event('d')]);
        assert.deepEqual(received, [2, 3, 4]);
        stop();
        log.append([event('e')]);
        assert.deepEqual(received, [2, 3, 4]);
        assert.throws(() => log.subscribe(-1, () => {}), RangeError);
    });

    test(`${driver}: failed batch rolls back and never notifies`, t => {
        const log = new SqliteEventLog(driver, ':memory:');
        t.after(() => log.close());
        const seen: number[] = [];
        log.subscribe(0, row => seen.push(row.seq));
        const cyclic: { self?: unknown } = {};
        cyclic.self = cyclic;
        assert.throws(() => log.append([event('a'), { ...event('b'), payload: cyclic }]));
        assert.deepEqual(log.readFrom(0, 10), []);
        assert.deepEqual(seen, []);
        assert.deepEqual(log.append([event('c')]), { first: 1, last: 1, count: 1 });
    });

    test(`${driver}: SIGKILL mid-batch preserves committed rows, no partial batch`, { timeout: 15_000 }, async t => {
        const path = `${mkdtempSync(`${root}/crash-`)}/events.sqlite`;
        const child = fork(fileURLToPath(new URL('./crash-worker.ts', import.meta.url)), [driver, path],
            { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
        t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
        const exited = once(child, 'exit');
        assert.deepEqual(await Promise.race([
            once(child, 'message'), exited.then(result => { throw new Error(`Premature exit ${result}`); })
        ]), ['mid-batch', undefined]);
        child.kill('SIGKILL');
        const [, signal] = await exited;
        assert.equal(signal, 'SIGKILL');
        const log = new SqliteEventLog(driver, path);
        t.after(() => log.close());
        assert.deepEqual(log.readFrom(0, 10).map(row => row.idempotencyKey), ['committed']);
        assert.deepEqual(log.append([event('after-crash')]), { first: 2, last: 2, count: 1 });
        const db = connect(driver, path);
        assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map(Object.values), [['ok']]);
        db.close();
    });
}
