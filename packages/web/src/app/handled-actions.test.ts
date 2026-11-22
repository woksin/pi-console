import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindingsFor, type Action, type KeyContext } from '@pi-console/viewmodels';
import { knownMissing, webHandled } from './handled-actions.ts';

/** Contexts the web client can be in (`contextFor`), plus `transcript`, reached through the session's `detail` fallback. */
const reachable: readonly KeyContext[] = ['global', 'overview', 'fleet', 'requests', 'questions', 'messages', 'work', 'detail', 'transcript', 'timeline', 'graph', 'palette', 'help'];

const ownerOf = (context: KeyContext): KeyContext => (context === 'transcript' ? 'detail' : context);
const has = (table: Partial<Record<KeyContext, readonly Action[]>>, context: KeyContext, action: Action): boolean => table[context]?.includes(action) ?? false;
const isHandled = (context: KeyContext, action: Action): boolean => has(webHandled, ownerOf(context), action) || has(webHandled, 'global', action) || has(knownMissing, ownerOf(context), action);

test('every binding the keymap enables for the web has a registered web handler', () => {
  const missing = bindingsFor('web').flatMap(binding => binding.contexts
    .filter(context => reachable.includes(context) && !isHandled(context, binding.action))
    .map(context => `${context}: ${binding.keys.join('/')} (${binding.action})`));
  assert.deepEqual(missing, []);
});

test('known missing web handlers are only ones the keymap still enables (remove them when #128 lands)', () => {
  for (const [context, actions] of Object.entries(knownMissing) as [KeyContext, readonly Action[]][]) for (const action of actions) {
    assert.ok(bindingsFor('web').some(binding => binding.action === action && binding.contexts.includes(context)), `${context} ${action}`);
    assert.ok(!has(webHandled, context, action), `${context} ${action} is handled now`);
  }
});
