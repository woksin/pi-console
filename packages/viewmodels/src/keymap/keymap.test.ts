import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeBindings, bindings, bindingsFor, hints, keyLabel, keymapGroups, listContexts, resolve } from './keymap.ts';

test('no key is bound twice within one context', () => {
  const seen = new Map<string, string>();
  for (const binding of activeBindings) for (const context of binding.contexts) for (const key of binding.keys) {
    const id = `${context}:${key}`;
    assert.equal(seen.get(id), undefined, `${id} bound to ${seen.get(id) ?? ''} and ${binding.action}`);
    seen.set(id, binding.action);
  }
});

test('Enter opens the full transcript entry in the TUI only', () => {
  assert.equal(resolve('transcript', 'Enter', 'tui'), 'entry.open');
  assert.equal(resolve('transcript', 'Enter', 'web'), undefined);
  assert.ok(keymapGroups('tui').find(group => group.title === 'Transcript')?.bindings.some(binding => binding.action === 'entry.open'));
});

test('resolve falls back to global bindings except while typing', () => {
  assert.equal(resolve('fleet', '2'), 'section.2');
  assert.equal(resolve('fleet', 'j'), 'move.down');
  assert.equal(resolve('transcript', 'f'), 'follow.toggle');
  assert.equal(resolve('filter', '2'), undefined);
  assert.equal(resolve('palette', 'Enter'), 'open');
  assert.equal(resolve('fleet', 'Ctrl+C'), 'quit');
});

test('intervention keys are listed but inert until M4; destructive key is uppercase', () => {
  assert.equal(resolve('fleet', 'a'), undefined);
  assert.equal(resolve('detail', 'A'), undefined);
  assert.equal(bindings.find(binding => binding.action === 'abort')?.keys[0], 'A');
});

test('view-only actions and client-only keys never leak to unrelated hints or web help', () => {
  for (const context of listContexts) {
    assert.equal(hints(context, 'web').includes('v graph'), context === 'messages', context);
    assert.equal(resolve(context, 'v', 'web'), context === 'messages' ? 'view.toggle' : undefined);
    assert.equal(resolve(context, 'Space'), context === 'fleet' ? 'group.toggle' : undefined);
    assert.equal(resolve(context, ']'), context === 'requests' ? 'filter.next' : undefined);
  }
  assert.ok(!bindingsFor('web').some(binding => binding.action === 'quit'));
  assert.ok(bindingsFor('tui').some(binding => binding.action === 'quit'));
  assert.equal(resolve('fleet', 'q', 'web'), undefined);
});

test('help groups cover each shipped client binding once and render arrows as glyphs', () => {
  const groups = keymapGroups('tui');
  assert.deepEqual(groups.map(group => group.title), ['Navigate', 'Lists', 'Transcript', 'Memory', 'Timeline', 'Global']);
  const grouped = groups.flatMap(group => group.bindings);
  assert.equal(new Set(grouped).size, activeBindings.length);
  assert.equal(grouped.length, activeBindings.length);
  assert.ok(!keymapGroups('web').flatMap(group => group.bindings).some(binding => binding.action === 'quit'));
  assert.deepEqual(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].map(keyLabel), ['↑', '↓', '←', '→']);
});

test('attention retry is an Overview-only TUI binding included in help and hints', () => {
  assert.equal(resolve('overview', 'r'), 'attention.retry');
  assert.equal(resolve('overview', 'r', 'web'), undefined);
  for (const context of ['fleet', 'filter', 'help', 'transcript'] as const) assert.equal(resolve(context, 'r'), undefined);
  assert.ok(hints('overview').includes('r retry'));
  assert.ok(keymapGroups('tui').flatMap(group => group.bindings).some(binding => binding.action === 'attention.retry'));
});

test('hints are context-specific and de-duplicated', () => {
  const list = hints('fleet');
  assert.ok(list.includes('j/k move'));
  assert.equal(new Set(list).size, list.length);
  assert.ok(!hints('palette').includes('? help'));
});

test('pane cycling and the timeline scrubber are TUI-only; the graph scrubber stays shared', () => {
  for (const context of ['detail', 'transcript'] as const) for (const key of ['Tab', 'Shift+Tab']) {
    assert.equal(resolve(context, key, 'web'), undefined);
    assert.ok(resolve(context, key, 'tui'));
  }
  assert.equal(resolve('timeline', 't', 'web'), undefined);
  assert.equal(resolve('timeline', 't', 'tui'), 'time.scrub');
  assert.equal(resolve('graph', 't', 'web'), 'time.scrub');
  assert.ok(!hints('detail', 'web').includes('tab pane'));
  assert.ok(hints('detail', 'tui').includes('tab pane'));
});

test('the time scrubber is listed once per client', () => {
  for (const client of ['web', 'tui'] as const) assert.equal(bindingsFor(client).filter(binding => binding.action === 'time.scrub').length, 1, client);
});
