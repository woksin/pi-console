import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultDataDir } from '@pi-console/daemon';
import { daemonUsage, parseDaemonArgs, runDaemon } from './daemon-command.ts';

test('flags override only what they name', () => {
  const parsed = parseDaemonArgs(['--data-dir', '/tmp/x', '--port', '0', '--sessions', '/a', '--sessions', '/b', '--backfill-days', '2'], {});
  assert.equal(parsed.dataDir, '/tmp/x');
  assert.deepEqual(parsed.overrides, { port: 0, sessionRoots: ['/a', '/b'], backfillWindowDays: 2 });
  assert.deepEqual(parseDaemonArgs([], {}).overrides, {});
  assert.throws(() => parseDaemonArgs(['--port', 'abc']), /--port/);
  assert.throws(() => parseDaemonArgs(['--bind', '0.0.0.0']), /bind/);
});

test('the data directory falls back to PI_CONSOLE_DATA_DIR and resolves relative paths', () => {
  const parsed = parseDaemonArgs([], { PI_CONSOLE_DATA_DIR: 'console-data' });
  assert.equal(parsed.dataDir, resolve('console-data'));
  assert.deepEqual(parsed.overrides, {});
});

test('an explicit data directory takes precedence over PI_CONSOLE_DATA_DIR', () => {
  assert.equal(parseDaemonArgs(['--data-dir', 'flag-data'], { PI_CONSOLE_DATA_DIR: '/env-data' }).dataDir, resolve('flag-data'));
});

test('the default data directory is used when neither flag nor environment names one', () => {
  assert.equal(parseDaemonArgs([], {}).dataDir, resolve(defaultDataDir()));
  assert.match(daemonUsage, /--data-dir.*flag > PI_CONSOLE_DATA_DIR > ~\/\.pi-console/);
});

test('source flags derive the roots, switch sources off and reject unknown ids', () => {
  const { overrides } = parseDaemonArgs(['--agent-root', '/agent', '--orch-root', '/orch', '--no-source', 'issue-work', '--no-source', 'phase-ledger', '--source-poll-ms', '500'], {});
  assert.deepEqual(overrides, { agentRoot: '/agent', orchRoot: '/orch', sources: { 'issue-work': false, 'phase-ledger': false }, sourcePollMs: 500 });
  assert.throws(() => parseDaemonArgs(['--no-source', 'nope']), /unknown source "nope".*context-budget/);
  assert.match(daemonUsage, /--agent-root/);
});

test('lane directories come from flags, then LANES_DIR, LANE_STATUS_DIR and INBOX_DIR/status; the daemon never reads the environment', () => {
  assert.deepEqual(parseDaemonArgs(['--lanes-root', '/l', '--lane-status-dir', '/s'], { LANES_DIR: '/env-l', LANE_STATUS_DIR: '/env-s' }).overrides, { lanesRoot: '/l', laneStatusDir: '/s' });
  assert.deepEqual(parseDaemonArgs([], { LANES_DIR: '/env-l', LANE_STATUS_DIR: '/env-s', INBOX_DIR: '/inbox' }).overrides, { lanesRoot: '/env-l', laneStatusDir: '/env-s' });
  assert.deepEqual(parseDaemonArgs([], { INBOX_DIR: '/inbox' }).overrides, { laneStatusDir: '/inbox/status' });
  assert.match(daemonUsage, /--lanes-root[\s\S]*--lane-status-dir/);
});

test('a poll interval below the minimum is refused before anything starts', async () => {
  const io = { out: () => undefined, stopSignal: new Promise<void>(() => undefined), env: {} };
  await assert.rejects(runDaemon(['--data-dir', join(tmpdir(), 'pi-console-never'), '--source-poll-ms', '0'], io), /--source-poll-ms must be an integer 250-60000/);
});

test('the daemon command serves the API until stopped and never prints the token', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-cli-'));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });
  const lines: string[] = [];
  let stop = (): void => undefined;
  const stopSignal = new Promise<void>(resolve => { stop = resolve; });
  const running = runDaemon(['--data-dir', directory, '--port', '0', '--sessions', join(directory, 'none'), '--agent-root', join(directory, 'agent'), '--orch-root', join(directory, 'orch')], { out: line => lines.push(line), stopSignal, env: {} });
  for (let i = 0; i < 200 && lines.length < 3; i++) await new Promise(resolve => setTimeout(resolve, 10));
  const port = Number(/127\.0\.0\.1:(\d+)/.exec(lines[0])?.[1]);
  const token = readFileSync(join(directory, 'token'), 'utf8').trim();
  const reply = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(reply.status, 200);
  assert.equal(lines.join('\n').includes(token), false);
  stop();
  assert.equal(await running, 0);
});

async function startedLines(directory: string, extra: string[]): Promise<{ lines: string[]; finish: () => Promise<number> }> {
  const lines: string[] = [];
  let stop = (): void => undefined;
  const stopSignal = new Promise<void>(resolve => { stop = resolve; });
  const running = runDaemon(['--data-dir', directory, '--port', '0', '--sessions', join(directory, 'none'), '--agent-root', join(directory, 'agent'), '--orch-root', join(directory, 'orch'), ...extra], { out: line => lines.push(line), stopSignal, env: {} });
  for (let i = 0; i < 200 && lines.length < 3; i++) await new Promise(resolve => setTimeout(resolve, 10));
  return { lines, finish: () => { stop(); return running; } };
}

test('without a usable web bundle the daemon says it is API only and prints no launch link', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-cli-'));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });
  mkdirSync(join(directory, 'asdir', 'index.html'), { recursive: true });
  for (const extra of [[], ['--web-dist', join(directory, 'missing')], ['--web-dist', join(directory, 'asdir')]]) {
    const { lines, finish } = await startedLines(directory, extra);
    assert.match(lines[2], /^API only: start with --web-dist <path to packages\/web\/dist>/);
    assert.equal(lines.join('\n').includes('#token='), false);
    assert.equal(lines.join('\n').includes(readFileSync(join(directory, 'token'), 'utf8').trim()), false);
    assert.equal(await finish(), 0);
  }
});

test('with a web bundle the daemon prints one launch link with the token in the fragment', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-cli-'));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });
  const dist = join(directory, 'dist');
  mkdirSync(dist);
  writeFileSync(join(dist, 'index.html'), '<!doctype html>');
  const { lines, finish } = await startedLines(directory, ['--web-dist', dist]);
  const token = readFileSync(join(directory, 'token'), 'utf8').trim();
  const port = /127\.0\.0\.1:(\d+)/.exec(lines[0])?.[1];
  assert.equal(lines[2], `open the web console: http://127.0.0.1:${String(port)}/#token=${token}`);
  assert.equal(lines.filter(line => line.includes(token)).length, 1);
  assert.equal(await finish(), 0);
});

test('help prints usage without starting anything', async () => {
  const lines: string[] = [];
  assert.equal(await runDaemon(['--help'], { out: line => lines.push(line), stopSignal: Promise.resolve() }), 0);
  assert.match(lines[0], /http:\/\/127\.0\.0\.1:<port>\/#token=<token>/);
  assert.equal(lines[0].includes('?token='), false);
});

test('startup lists the resolved agent root and source directories after the URL and token lines', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-cli-'));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });
  const { lines, finish } = await startedLines(directory, []);
  assert.match(lines[0], /^pi-console daemon listening on /);
  assert.ok(lines.includes(`Agent root: ${join(directory, 'agent')} [missing]`), lines.join('\n'));
  assert.ok(lines.some(line => line.startsWith('Source issue-work: ') && line.endsWith('[missing]')));
  assert.equal(await finish(), 0);
});
