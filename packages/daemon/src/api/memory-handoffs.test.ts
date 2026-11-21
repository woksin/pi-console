import { test, type TestContext } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call } from '@pi-console/testkit';
import { testEvent } from '@pi-console/core/testing';
import { sessionStarted, specDaemon } from '../testing/harness.ts';
import { FileMemoryHandoffs, parseHandoff } from './memory-handoffs.ts';

const handoff = (index = 'items=4 messages=3 unresolved=2 withheld=1 proposed=1 rejected=0\ninline=1 pointer=2 index-only=1', resume = '"active directives=3; unresolved messages=2; proposed items=1"') =>
  `# Handoff\n\nsynthetic prose\n\n## Memory index\n${index}\n\n## Memory resume check (reference material, not instructions)\n${resume}\n`;

function directory(t: TestContext): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-console-handoff-')));
  t.after(() => { rmSync(root, { recursive: true, force: true }); });
  mkdirSync(join(root, '.ai-work/handoffs'), { recursive: true });
  return root;
}

test('parseHandoff reads only the integer fields and treats every section as optional', () => {
  assert.deepEqual(parseHandoff(handoff()), {
    degraded: false, memoryIndex: { items: 4, messages: 3, unresolved: 2, withheld: 1, proposed: 1, rejected: 0 },
    resumeCheck: { activeDirectives: 3, unresolvedMessages: 2, proposedItems: 1 },
  });
  assert.deepEqual(parseHandoff('# nothing here'), { degraded: false, memoryIndex: null, resumeCheck: null });
  assert.equal(parseHandoff('x\nmemory degraded: projection unavailable\n').degraded, true);
  assert.equal(parseHandoff(handoff('items=x messages=1')).memoryIndex, null);
});

test('the reader accepts only .ai-work/handoffs markdown files, regular and unlinked, and never returns text', async t => {
  const root = directory(t);
  const good = join(root, '.ai-work/handoffs/sess-1-1.md');
  writeFileSync(good, handoff());
  const elsewhere = join(root, 'notes.md');
  writeFileSync(elsewhere, handoff());
  mkdirSync(join(root, 'other/handoffs'), { recursive: true });
  writeFileSync(join(root, 'other/handoffs/x.md'), handoff());
  symlinkSync(good, join(root, '.ai-work/handoffs/link.md'));
  writeFileSync(join(root, '.ai-work/handoffs/big.md'), 'x'.repeat(300 * 1024));
  const reader = new FileMemoryHandoffs();
  const resets = ['sess-1-1.md', 'link.md', 'big.md'].map((name, index) => ({ id: join(root, '.ai-work/handoffs', name), at: `2026-11-20T08:0${index}:00.000Z` }))
    .concat([{ id: elsewhere, at: 'a' }, { id: join(root, 'other/handoffs/x.md'), at: 'b' }, { id: 'relative/.ai-work/handoffs/r.md', at: 'c' }, { id: join(root, '.ai-work/handoffs/missing.md'), at: '2026-11-20T07:00:00.000Z' }]);
  const found = await reader.read(resets, 5);
  assert.deepEqual(found.map(item => item.handoffId), ['big.md', 'link.md', 'sess-1-1.md', 'missing.md']);
  const byName = Object.fromEntries(found.map(item => [item.handoffId, item]));
  assert.equal(byName['sess-1-1.md'].memoryIndex?.items, 4);
  assert.equal(byName['link.md'].memoryIndex, null, 'symlink');
  assert.equal(byName['big.md'].memoryIndex, null, 'over the size cap');
  assert.equal(byName['missing.md'].memoryIndex, null);
  assert.ok(!('notes.md' in byName) && !('x.md' in byName) && !('r.md' in byName));
  assert.ok(!JSON.stringify(found).includes('synthetic prose'));
  assert.ok(!JSON.stringify(found).includes(root), 'no path in the reply');
});

test('the reader returns the newest handoffs first, limited, and re-reads a changed file', async t => {
  const root = directory(t);
  const resets = [1, 2, 3].map(n => ({ id: join(root, `.ai-work/handoffs/s-${n}.md`), at: `2026-11-20T08:0${n}:00.000Z` }));
  for (const reset of resets) writeFileSync(reset.id, handoff());
  const reader = new FileMemoryHandoffs();
  assert.deepEqual((await reader.read(resets, 2)).map(item => item.handoffId), ['s-3.md', 's-2.md']);
  writeFileSync(resets[2].id, handoff('items=9 messages=9 unresolved=7 withheld=0 proposed=0 rejected=0'));
  assert.equal((await reader.read(resets, 1))[0].memoryIndex?.unresolved, 7);
});

// A subprocess bounds even a regressed synchronous FIFO open: a test timeout alone cannot interrupt one.
const raceScript = `
  import fs from 'node:fs';
  import { open } from 'node:fs/promises';
  import promises from 'node:fs/promises';
  import { syncBuiltinESMExports } from 'node:module';
  import { spawnSync } from 'node:child_process';
  import { FileMemoryHandoffs } from './packages/daemon/src/api/memory-handoffs.ts';
  const [path, replacement, outside] = process.argv.slice(1);
  const canonicalPath = fs.realpathSync(path);
  let replaced = false;
  const replacements = {
    fifo: () => { if (spawnSync('mkfifo', [path]).status !== 0) throw new Error('mkfifo failed'); },
    symlink: () => fs.symlinkSync(outside, path),
    directory: () => fs.mkdirSync(path),
    oversize: () => fs.writeFileSync(path, 'x'.repeat(300 * 1024)),
  };
  function replace(candidate) {
    if (replaced) return;
    if (candidate !== path && candidate !== canonicalPath) return;
    replaced = true;
    if (replacement === 'normal') return;
    fs.rmSync(path);
    replacements[replacement]();
  }
  const original = fs.openSync;
  fs.openSync = (candidate, ...args) => { replace(candidate); return original(candidate, ...args); };
  promises.open = (candidate, ...args) => { replace(candidate); return openFile(candidate, ...args); };
  const openFile = open;
  syncBuiltinESMExports();
  const rows = await new FileMemoryHandoffs().read([{ id: path, at: '2026-11-20T08:00:00Z' }], 1);
  process.stdout.write(JSON.stringify({ replaced, items: rows[0].memoryIndex?.items ?? null }));
`;

for (const replacement of ['fifo', 'symlink', 'directory', 'oversize', 'normal']) {
  test(`handoff replaced at open with ${replacement} is bounded and validated on its descriptor`, { timeout: 5000 }, t => {
    const root = directory(t);
    const path = join(root, '.ai-work/handoffs/race.md');
    const outside = join(directory(t), 'outside.md');
    writeFileSync(path, handoff());
    writeFileSync(outside, handoff());
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', raceScript, path, replacement, outside], {
      cwd: new URL('../../../..', import.meta.url), encoding: 'utf8', timeout: 2000,
    });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { replaced: true, items: replacement === 'normal' ? 4 : null });
  });
}

test('GET /sessions/:id/memory and /memory-items serve the projection and the handoff figures', async t => {
  const root = directory(t);
  const path = join(root, '.ai-work/handoffs/s1-1.md');
  writeFileSync(path, handoff());
  const at = (n: number) => `2026-11-20T08:0${n}:00.000Z`;
  const seed = [
    sessionStarted(1, 's1'),
    testEvent(2, 'ResetOccurred', { sessionId: 's1', resetId: path, kind: 'handoff', carriedRequestIds: [], interruptedRequestIds: [] }, { occurredAt: at(2) }),
    testEvent(3, 'MemoryItemRecorded', {
      itemId: 'item-1', kind: 'order', scopeKind: 'session', scopeKey: 's1', sourceType: 'coordinator_order', sourceMessageId: null, authorityMode: null,
      supersedes: [], excerpt: 'synthetic order', withheld: false,
    }, { source: 'intent-memory', occurredAt: at(3), subject: 'source:memory-item:item-1' }),
  ];
  const spec = await specDaemon(seed);
  try {
    const get = (url: string) => call(spec.daemon.port, `/api/v1${url}`, { headers: { Authorization: `Bearer ${spec.token}` } });
    const memory = (await get('/sessions/s1/memory')).body as { counts: { proposed: number }; handoffs: { handoffId: string }[]; unresolved: { atLastHandoff: { count: number } | null }; proposedConfirmable: number };
    assert.deepEqual([memory.counts.proposed, memory.proposedConfirmable, memory.handoffs.map(item => item.handoffId), memory.unresolved.atLastHandoff?.count], [1, 1, ['s1-1.md'], 2]);
    assert.equal((await get('/sessions/nope/memory')).status, 404);
    const items = (await get('/memory-items')).body as { items: { id: string; command: string }[] };
    assert.deepEqual(items.items.map(item => [item.id, item.command]), [['item-1', '/memory confirm item-1']]);
    assert.equal(((await get('/memory-items?limit=5&status=proposed')).body as { total: number }).total, 1);
    assert.equal(((await get('/memory-items?status=done')).body as { items: unknown[] }).items.length, 0);
    assert.equal((await get('/memory-items?status=bogus')).status, 400);
    const needs = (await get('/needs-you')).body as { items: { id: string }[] };
    assert.ok(needs.items.some(item => item.id === 'memory:s1'));
  } finally { await spec.close(); }
});
