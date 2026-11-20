import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAgentTree } from './agent-tree.ts';
import { secretsIn } from './secret-shapes.ts';

function build(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pi-console-tree-'));
  return { root, tree: buildAgentTree(root, options), cleanup: () => rmSync(root, { recursive: true }) };
}

test('tree has every source directory and session JSONL parses line by line', t => {
  const { root, tree, cleanup } = build();
  t.after(cleanup);
  for (const part of ['sessions', 'context-budget', 'lanes', 'questions', 'jobs', 'phases', 'reviews', 'heartbeats']) {
    assert.ok(tree.files.some(file => file.startsWith(join(root, part))), part);
  }
  assert.equal(tree.sessions.length, 2);
  for (const line of readFileSync(tree.sessions[1].file, 'utf8').trimEnd().split('\n')) JSON.parse(line);
});

test('the tree is deterministic', t => {
  const first = build();
  const second = build();
  t.after(() => { first.cleanup(); second.cleanup(); });
  assert.equal(readFileSync(first.tree.sessions[0].file, 'utf8'), readFileSync(second.tree.sessions[0].file, 'utf8'));
});

test('tornLastLine leaves an unterminated, unparseable final line', t => {
  const { tree, cleanup } = build({ tornLastLine: true });
  t.after(cleanup);
  const text = readFileSync(tree.sessions[0].file, 'utf8');
  assert.ok(!text.endsWith('\n'));
  assert.throws(() => JSON.parse(text.split('\n').at(-1)!));
  for (const line of text.split('\n').slice(0, -1)) JSON.parse(line);
});

test('secrets appear only when asked for, in a session and a question', t => {
  const clean = build();
  const dirty = build({ includeSecrets: true });
  t.after(() => { clean.cleanup(); dirty.cleanup(); });
  const all = (tree: typeof clean.tree) => tree.files.map(file => readFileSync(file, 'utf8')).join('\n');
  assert.deepEqual(secretsIn(all(clean.tree)), []);
  assert.ok(secretsIn(all(dirty.tree)).length > 5);
  assert.ok(secretsIn(readFileSync(join(dirty.root, 'questions/q-1/rev-0001.json'), 'utf8')).length > 5);
});
