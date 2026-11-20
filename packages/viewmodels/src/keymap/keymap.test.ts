import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeBindings, bindings, hints, resolve } from './keymap.ts';

test('no key is bound twice within one context', () => {
  const seen = new Map<string, string>();
  for (const binding of activeBindings) for (const context of binding.contexts) for (const key of binding.keys) {
    const id = `${context}:${key}`;
    assert.equal(seen.get(id), undefined, `${id} bound to ${seen.get(id) ?? ''} and ${binding.action}`);
    seen.set(id, binding.action);
  }
});

test('resolve falls back to global bindings except while typing', () => {
  assert.equal(resolve('list', '2'), 'section.2');
  assert.equal(resolve('list', 'j'), 'move.down');
  assert.equal(resolve('transcript', 'f'), 'follow.toggle');
  assert.equal(resolve('filter', '2'), undefined);
  assert.equal(resolve('palette', 'Enter'), 'open');
  assert.equal(resolve('list', 'Ctrl+C'), 'quit');
});

test('intervention keys are listed but inert until M4; destructive key is uppercase', () => {
  assert.equal(resolve('list', 'a'), undefined);
  assert.equal(resolve('detail', 'A'), undefined);
  assert.equal(bindings.find(binding => binding.action === 'abort')?.keys[0], 'A');
});

test('hints are context-specific and de-duplicated', () => {
  const list = hints('list');
  assert.ok(list.includes('j/k move'));
  assert.equal(new Set(list).size, list.length);
  assert.ok(!hints('palette').includes('? help'));
});
