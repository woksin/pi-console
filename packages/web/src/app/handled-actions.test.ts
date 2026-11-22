import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindingsFor, type Action, type KeyContext } from '@pi-console/viewmodels';
import { webHandled } from './handled-actions.ts';

/** Contexts the web client can be in (`contextFor`), plus `transcript`, reached through the session's `detail` fallback. */
const reachable: readonly KeyContext[] = ['global', 'overview', 'fleet', 'requests', 'questions', 'messages', 'work', 'detail', 'transcript', 'timeline', 'graph', 'palette', 'help'];

const ownerOf = (context: KeyContext): KeyContext => (context === 'transcript' ? 'detail' : context);
const has = (table: Partial<Record<KeyContext, readonly Action[]>>, context: KeyContext, action: Action): boolean => table[context]?.includes(action) ?? false;
const isHandled = (context: KeyContext, action: Action): boolean => has(webHandled, ownerOf(context), action) || has(webHandled, 'global', action);

test('every binding the keymap enables for the web has a registered web handler', () => {
  const missing = bindingsFor('web').flatMap(binding => binding.contexts
    .filter(context => reachable.includes(context) && !isHandled(context, binding.action))
    .map(context => `${context}: ${binding.keys.join('/')} (${binding.action})`));
  assert.deepEqual(missing, []);
});

test('`/` is handled on every list the keymap enables it for, and not offered on the Overview', () => {
  const contexts = bindingsFor('web').filter(binding => binding.action === 'filter.open').flatMap(binding => binding.contexts);
  for (const context of ['fleet', 'requests', 'questions', 'messages', 'work'] as const) {
    assert.ok(contexts.includes(context), `${context} enables filter.open`);
    assert.ok(has(webHandled, context, 'filter.open'), `${context} handles filter.open`);
  }
  assert.ok(!contexts.includes('overview'));
});
