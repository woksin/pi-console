import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fsModule from 'node:fs';
import { mock, test, type TestContext } from 'node:test';
import { defaultConfig, type DaemonConfig } from '../config.ts';
import { directoryDiagnostics, isProblem, summarizeAvailability } from './source-availability.ts';

function tree(t: TestContext): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-console-availability-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function configAt(root: string, overrides: Partial<DaemonConfig> & { ingest?: boolean } = {}): DaemonConfig & { ingest?: boolean } {
  const agentRoot = join(root, 'agent');
  return { ...defaultConfig(join(root, 'data')), agentRoot, orchRoot: join(root, 'orch'), laneStatusDir: join(agentRoot, 'lane-status'), sessionRoots: [join(agentRoot, 'sessions')], ...overrides };
}

const summary = (config: DaemonConfig & { ingest?: boolean }) => summarizeAvailability(directoryDiagnostics(config));

test('an absent agent root and its derived directories are missing, and nothing is created', t => {
  const root = tree(t);
  const result = summary(configAt(root));
  assert.equal(result.get('agent-root'), 'missing');
  assert.equal(result.get('session-jsonl'), 'missing');
  assert.equal(result.get('issue-work'), 'missing');
  assert.equal(result.get('lane-heartbeats'), 'missing');
  assert.equal([...result.values()].some(isProblem), true);
  assert.throws(() => realpathSync(join(root, 'agent')), { code: 'ENOENT' });
});

test('present empty directories are available, and an absent child makes only its source missing', t => {
  const root = tree(t);
  const agent = join(root, 'agent');
  for (const directory of ['sessions', 'user-questions/items', 'context-budget', 'memory', 'memory/journal', 'pi-phase/state/ledger', 'lane-status']) mkdirSync(join(agent, directory), { recursive: true });
  mkdirSync(join(root, 'orch/inbox'), { recursive: true });
  const result = summary(configAt(root));
  assert.equal(result.get('agent-root'), 'available');
  assert.equal(result.get('session-jsonl'), 'available');
  assert.equal(result.get('question-store'), 'available');
  assert.equal(result.get('lane-messages'), 'available');
  assert.equal(result.get('intent-memory'), 'available');
  assert.equal(result.get('issue-work'), 'missing');
  assert.equal(result.get('lane-heartbeats'), 'missing');
});

test('a source with several directories is missing when any one of them is, and each path is listed once', t => {
  const root = tree(t);
  mkdirSync(join(root, 'agent/memory/events'), { recursive: true });
  mkdirSync(join(root, 'agent/memory'), { recursive: true });
  const diagnostics = directoryDiagnostics(configAt(root)).filter(item => item.owner === 'intent-memory');
  assert.deepEqual(diagnostics.map(item => [item.path, item.state]), [[join(root, 'agent/memory'), 'available'], [join(root, 'agent/memory/journal'), 'missing']]);
  assert.equal(summarizeAvailability(diagnostics).get('intent-memory'), 'missing');
});

test('a regular file in place of a directory is unavailable, not available', t => {
  const root = tree(t);
  mkdirSync(join(root, 'agent'), { recursive: true });
  writeFileSync(join(root, 'agent/sessions'), 'file');
  writeFileSync(join(root, 'agent/context-budget'), 'file');
  const result = summary(configAt(root));
  assert.equal(result.get('session-jsonl'), 'unavailable');
  assert.equal(result.get('context-budget'), 'unavailable');
});

test('a lookup failure other than absence is unavailable, never a raw error', t => {
  const root = tree(t);
  mkdirSync(join(root, 'agent'), { recursive: true });
  writeFileSync(join(root, 'agent/sessions'), 'file');
  const result = summary(configAt(root, { sessionRoots: [join(root, 'agent/sessions/child')] }));
  assert.equal(result.get('session-jsonl'), 'unavailable');
});

test('a trusted configured alias is followed, but a symlink below the root is not', t => {
  const root = tree(t);
  mkdirSync(join(root, 'real/context-budget'), { recursive: true });
  mkdirSync(join(root, 'elsewhere'), { recursive: true });
  symlinkSync(join(root, 'real'), join(root, 'agent'));
  assert.equal(summary(configAt(root)).get('context-budget'), 'available');
  rmSync(join(root, 'real/context-budget'), { recursive: true });
  symlinkSync(join(root, 'elsewhere'), join(root, 'real/context-budget'));
  assert.equal(summary(configAt(root)).get('context-budget'), 'unavailable');
});

test('overridden and relative roots are resolved, and the agent root is checked even when every path is overridden', t => {
  const root = tree(t);
  const sessions = join(root, 'custom-sessions');
  mkdirSync(sessions);
  const result = summary(configAt(root, { sessionRoots: [sessions] }));
  assert.equal(result.get('session-jsonl'), 'available');
  assert.equal(result.get('agent-root'), 'missing');
  const relative = directoryDiagnostics(configAt(root, { sessionRoots: ['relative-sessions'] })).find(item => item.owner === 'session-jsonl');
  assert.equal(relative?.path, join(process.cwd(), 'relative-sessions'));
});

test('disabled ingestion, disabled sources and no session roots are disabled without requiring the paths to exist', t => {
  const root = tree(t);
  const off = summary(configAt(root, { ingest: false }));
  assert.deepEqual([...new Set(off.values())], ['disabled']);
  const config = configAt(root, { sessionRoots: [] });
  config.sources['issue-work'] = false;
  const result = summary(config);
  assert.equal(result.get('issue-work'), 'disabled');
  assert.equal(result.has('session-jsonl'), false);
  assert.equal(result.get('context-budget'), 'missing');
});

test('optional lane feeds appear only when configured, and a directory that appears later is picked up on the next call', t => {
  const root = tree(t);
  const lanes = join(root, 'lanes');
  const without = directoryDiagnostics(configAt(root)).filter(item => item.owner === 'lane-messages').map(item => item.path);
  assert.equal(without.includes(lanes), false);
  const config = configAt(root, { lanesRoot: lanes });
  assert.equal(summary(config).get('lane-messages'), 'missing');
  mkdirSync(join(root, 'orch/inbox'), { recursive: true });
  mkdirSync(join(lanes, '.state/roster'), { recursive: true });
  mkdirSync(join(root, 'agent/lane-status'), { recursive: true });
  assert.equal(summary(config).get('lane-messages'), 'available');
});

test('a directory that cannot be listed or traversed is unavailable, whatever the error says', t => {
  const root = tree(t);
  mkdirSync(join(root, 'agent/sessions'), { recursive: true });
  const denied = join(root, 'agent/sessions');
  const access = fsModule.accessSync.bind(fsModule);
  const mocked = mock.method(fsModule, 'accessSync', (path: string, mode?: number) => {
    if (path === denied) throw Object.assign(new Error(`EACCES: permission denied, access '${path}'`), { code: 'EACCES' });
    access(path, mode);
  });
  t.after(() => { mocked.mock.restore(); });
  const result = summary(configAt(root));
  assert.equal(result.get('session-jsonl'), 'unavailable');
  assert.equal(result.get('agent-root'), 'available');
  assert.equal(mocked.mock.calls.some(call => call.arguments[1] === (fsModule.constants.R_OK | fsModule.constants.X_OK)), true);
  const text = JSON.stringify([...result]);
  assert.equal(text.includes('EACCES') || text.includes(root), false);
});
