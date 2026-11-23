import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileStateStore, freshState, lostBudgetCooldownMs, maxStateBytes, stateValid } from './github-state.ts';

const directory = (t: test.TestContext): string => {
  const path = mkdtempSync(join(tmpdir(), 'pi-console-gh-'));
  t.after(() => { rmSync(path, { recursive: true, force: true }); });
  return path;
};
const now = Date.parse('2026-01-01T00:00:00Z');

test('first start is fresh; a saved state round-trips privately and atomically', t => {
  const dir = directory(t);
  const store = new FileStateStore(dir);
  const state = store.load(now);
  assert.deepEqual([state.pausedUntil, state.reservations.length], [0, 0]);
  state.reservations.push(now);
  state.targets['a/b#1'] = { kind: 'issue', state: 'closed', closedAt: '2025-12-31T00:00:00Z', fetchedAt: '2026-01-01T00:00:00Z', failures: 0, nextAt: now };
  assert.equal(store.save(state), true);
  assert.equal(statSync(join(dir, 'github-closures.json')).mode & 0o777, 0o600);
  assert.equal(existsSync(join(dir, 'github-closures.json.tmp')), false);
  assert.deepEqual(new FileStateStore(dir).load(now + 1).reservations, [now]);
});

test('a lost, corrupt, oversize, invalid or symlinked state after first use means a one-hour cooldown, never a renewed budget', t => {
  const bad: [string, (dir: string) => void][] = [
    ['deleted', dir => { rmSync(join(dir, 'github-closures.json')); }],
    ['corrupt', dir => { writeFileSync(join(dir, 'github-closures.json'), '{nope'); }],
    ['oversize', dir => { writeFileSync(join(dir, 'github-closures.json'), ' '.repeat(maxStateBytes + 1)); }],
    ['invalid', dir => { writeFileSync(join(dir, 'github-closures.json'), JSON.stringify({ ...freshState(now), targets: { '--repo': {} } })); }],
    ['symlink', dir => { rmSync(join(dir, 'github-closures.json')); writeFileSync(join(dir, 'real.json'), JSON.stringify(freshState(now))); symlinkSync(join(dir, 'real.json'), join(dir, 'github-closures.json')); }],
    ['directory', dir => { rmSync(join(dir, 'github-closures.json')); mkdirSync(join(dir, 'github-closures.json')); }],
  ];
  for (const [name, damage] of bad) {
    const dir = directory(t);
    const store = new FileStateStore(dir);
    assert.equal(store.save(store.load(now)), true);
    damage(dir);
    assert.equal(new FileStateStore(dir).load(now + 5).pausedUntil, now + 5 + lostBudgetCooldownMs, name);
  }
});

test('a failed write keeps the old state and reports failure; a planted temp symlink is never followed', t => {
  const dir = directory(t);
  const store = new FileStateStore(dir);
  assert.equal(store.save(store.load(now)), true);
  const before = readFileSync(join(dir, 'github-closures.json'), 'utf8');
  const victim = join(dir, 'victim');
  writeFileSync(victim, 'keep');
  symlinkSync(victim, join(dir, 'github-closures.json.tmp'));
  assert.equal(store.save({ ...freshState(now), pausedUntil: 5 }), true);
  assert.equal(readFileSync(victim, 'utf8'), 'keep');
  assert.equal(lstatSync(join(dir, 'github-closures.json')).isFile(), true);
  assert.notEqual(readFileSync(join(dir, 'github-closures.json'), 'utf8'), before);
  assert.equal(new FileStateStore(join(dir, 'missing', 'deeper')).save(freshState(now)), false);
});

test('validation rejects forged shapes, oversize collections and unknown values', () => {
  assert.equal(stateValid(freshState(now)), true);
  const entry = { kind: 'issue', state: 'closed', closedAt: null, fetchedAt: '2026-01-01T00:00:00Z', failures: 0, nextAt: 0 };
  for (const bad of [null, [], { ...freshState(now), version: 2 }, { ...freshState(now), reservations: Array(501).fill(1) }, { ...freshState(now), pausedUntil: -1 },
    { ...freshState(now), targets: { 'a/b#1': { ...entry, state: 'shut' } } }, { ...freshState(now), targets: { 'A/B#1': entry } },
    { ...freshState(now), targets: Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`a/b#${String(index + 1)}`, entry])) }]) assert.equal(stateValid(bad), false);
});
