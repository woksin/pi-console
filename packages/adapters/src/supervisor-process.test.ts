import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const childCode = `
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { AdapterSupervisor, FileTailer } from './packages/adapters/src/index.ts';
const [source, store] = process.argv.slice(1);
let state = JSON.parse(readFileSync(store, 'utf8'));
const log = {
  async checkpoints() { return state.checkpoints; },
  async append(events, checkpoints = []) {
    const fresh = events.filter(event => !state.events.some(old => old.idempotencyKey === event.idempotencyKey));
    const next = { events: [...state.events, ...fresh], checkpoints };
    writeFileSync(store + '.tmp', JSON.stringify(next));
    renameSync(store + '.tmp', store);
    state = next;
    return { appended: fresh.length, cursor: String(next.events.length) };
  }
};
const supervisor = new AdapterSupervisor(() => {
  const tailer = new FileTailer(log, 'context-budget', value => [{ type: 'SessionHeartbeat', subject: 'session:synthetic', occurredAt: value.at, payload: { sessionId: 'synthetic' } }]);
  return { poll: () => tailer.poll([source]), close: () => tailer.close() };
}, { intervalMs: 5 });
supervisor.start();
setInterval(() => { if (state.events.length >= Number(process.env.EXPECT_EVENTS)) process.send?.('committed'); }, 10);
`;

async function committed(child: ChildProcess): Promise<void> {
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    await Promise.race([
      once(child, 'message'),
      once(child, 'exit').then(() => { throw new Error('Worker exited before checkpoint commit'); }),
    ]);
  } finally { clearTimeout(timeout); }
}

async function kill(child: ChildProcess): Promise<void> {
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}

test('killed adapter process resumes durable checkpoint without gaps or duplicate events', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-supervisor-kill-'));
  let child: ChildProcess | undefined;
  try {
    const source = join(root, 'source.jsonl');
    const store = join(root, 'checkpoint.json');
    writeFileSync(source, '{"at":"2026-07-01T10:00:00Z"}\n');
    writeFileSync(store, JSON.stringify({ events: [], checkpoints: [] }));
    const launch = (expected: number) => spawn(process.execPath, ['--input-type=module', '-e', childCode, source, store], {
      cwd: new URL('../../../', import.meta.url), env: { ...process.env, EXPECT_EVENTS: String(expected) }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    child = launch(1);
    await committed(child);
    await kill(child);
    child = undefined;
    appendFileSync(source, '{"at":"2026-07-01T10:01:00Z"}\n');
    child = launch(2);
    await committed(child);
    await kill(child);
    child = undefined;
    const saved = JSON.parse(readFileSync(store, 'utf8'));
    assert.equal(saved.events.length, 2);
    assert.equal(new Set(saved.events.map((event: { idempotencyKey: string }) => event.idempotencyKey)).size, 2);
    assert.equal(saved.checkpoints[0].offset, Buffer.byteLength(readFileSync(source)));
  } finally {
    if (child?.exitCode === null && child.signalCode === null) await kill(child);
    rmSync(root, { recursive: true, force: true });
  }
});
