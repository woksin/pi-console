import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, type DirectoryDiagnostic } from '@pi-console/daemon';
import { formatDiagnostics, printStartupDiagnostics } from './startup-diagnostics.ts';

const item = (owner: DirectoryDiagnostic['owner'], path: string, state: DirectoryDiagnostic['state']): DirectoryDiagnostic => ({ owner, path, state });

test('every path prints with its state, and only missing or unavailable enabled paths warn', () => {
  const { lines, warnings } = formatDiagnostics([item('agent-root', '/a', 'missing'), item('session-jsonl', '/a/sessions', 'available'), item('phase-ledger', '/a/led', 'disabled'), item('issue-work', '/a/iw', 'unavailable')]);
  assert.deepEqual(lines, ['Agent root: /a [missing]', 'Source session-jsonl: /a/sessions [available]', 'Source phase-ledger: /a/led [disabled]', 'Source issue-work: /a/iw [unavailable]']);
  assert.deepEqual(warnings, [
    'Warning: missing directory /a (agent root). Check --agent-root / configured source directories, or create the intended directory; ingestion retries automatically.',
    'Warning: unavailable directory /a/iw (issue-work). Check that the path is a readable directory; ingestion retries automatically.',
  ]);
});

test('a path shared by several owners warns once and names them all', () => {
  const { warnings } = formatDiagnostics([item('agent-root', '/a', 'missing'), item('context-budget', '/a', 'missing'), item('issue-work', '/a', 'missing')]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^Warning: missing directory \/a \(agent root, context-budget, issue-work\)\./);
});

test('spaces are kept and control characters are escaped onto one line', () => {
  const { lines, warnings } = formatDiagnostics([item('issue-work', '/my dir/\u001b[31m\nx', 'missing')]);
  assert.equal(lines[0], 'Source issue-work: /my dir/\\x1b[31m\\x0ax [missing]');
  assert.equal(warnings[0].includes('\n') || warnings[0].includes('\u001b'), false);
});

test('printing resolves the configured directories, creates nothing and sends warnings separately', t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-console-startup-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); });
  const config = { ...defaultConfig(join(root, 'data')), agentRoot: join(root, 'agent'), orchRoot: join(root, 'orch'), laneStatusDir: join(root, 'status'), sessionRoots: [join(root, 'sessions')] };
  mkdirSync(join(root, 'sessions'));
  const out: string[] = [];
  const warnings: string[] = [];
  printStartupDiagnostics(config, line => out.push(line), line => warnings.push(line));
  assert.equal(out[0], `Agent root: ${join(root, 'agent')} [missing]`);
  assert.ok(out.includes(`Source session-jsonl: ${join(root, 'sessions')} [available]`));
  assert.ok(out.every(line => !line.startsWith('Warning')));
  assert.ok(warnings.some(line => line.includes(join(root, 'agent'))));
  assert.throws(() => mkdirSync(join(root, 'sessions')), { code: 'EEXIST' });
});
