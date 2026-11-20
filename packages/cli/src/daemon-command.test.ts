import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { daemonUsage, parseDaemonArgs, runDaemon } from './daemon-command.ts';

test('flags override only what they name', () => {
  const parsed = parseDaemonArgs(['--data-dir', '/tmp/x', '--port', '0', '--sessions', '/a', '--sessions', '/b', '--backfill-days', '2']);
  assert.equal(parsed.dataDir, '/tmp/x');
  assert.deepEqual(parsed.overrides, { port: 0, sessionRoots: ['/a', '/b'], backfillWindowDays: 2 });
  assert.deepEqual(parseDaemonArgs([]).overrides, {});
  assert.throws(() => parseDaemonArgs(['--port', 'abc']), /--port/);
  assert.throws(() => parseDaemonArgs(['--bind', '0.0.0.0']), /bind/);
});

test('source flags derive the roots, switch sources off and reject unknown ids', () => {
  const { overrides } = parseDaemonArgs(['--agent-root', '/agent', '--orch-root', '/orch', '--no-source', 'issue-work', '--no-source', 'phase-ledger', '--source-poll-ms', '500']);
  assert.deepEqual(overrides, { agentRoot: '/agent', orchRoot: '/orch', sources: { 'issue-work': false, 'phase-ledger': false }, sourcePollMs: 500 });
  assert.throws(() => parseDaemonArgs(['--no-source', 'nope']), /unknown source "nope".*context-budget/);
  assert.match(daemonUsage, /--agent-root/);
});

test('the daemon command serves the API until stopped and never prints the token', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-cli-'));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });
  const lines: string[] = [];
  let stop = (): void => undefined;
  const stopSignal = new Promise<void>(resolve => { stop = resolve; });
  const running = runDaemon(['--data-dir', directory, '--port', '0', '--sessions', join(directory, 'none'), '--agent-root', join(directory, 'agent'), '--orch-root', join(directory, 'orch')], { out: line => lines.push(line), stopSignal });
  for (let i = 0; i < 200 && lines.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 10));
  const port = Number(/127\.0\.0\.1:(\d+)/.exec(lines[0])?.[1]);
  const token = readFileSync(join(directory, 'token'), 'utf8').trim();
  const reply = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(reply.status, 200);
  assert.equal(lines.join('\n').includes(token), false);
  stop();
  assert.equal(await running, 0);
});

test('help prints usage without starting anything', async () => {
  const lines: string[] = [];
  assert.equal(await runDaemon(['--help'], { out: line => lines.push(line), stopSignal: Promise.resolve() }), 0);
  assert.match(lines[0], /127\.0\.0\.1/);
});
