import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MemoryItem, Session, SessionMemory } from '@pi-console/contract';
import { displayWidth } from '@pi-console/viewmodels';
import { memoryViewport } from '../shell/memory-overlay.ts';
import { initial } from '../state/ui.ts';
import { Store } from '../store/store.ts';
import { Screen, h, mountHeadless } from '../view/renderer.ts';
import { sessionView } from './session.ts';

const session: Session = {
  id: 's1', name: 'Current', repositoryId: 'repo', laneId: 'unassigned', branch: '', cwd: '/work/repo', role: 'main',
  parentSessionId: null, orchestratorSessionId: 's1', model: '', status: 'idle', startedAt: '', updatedAt: '', contextPercent: 0, samples: [],
};
const memory: SessionMemory = {
  sessionId: 's1', storeDetected: true, counts: { active: 0, proposed: 1, done: 0, superseded: 0, withdrawn: 0, rejected: 0 }, proposedConfirmable: 1,
  unresolved: { lowerBound: 1, atLastHandoff: null }, wider: 0, handoffs: [],
};
const item: MemoryItem = {
  id: 'item-1', kind: 'order', scope: { kind: 'session', key: 's1' }, sessionId: 's1', status: 'proposed', statusBasis: 'recorded', text: 'synthetic order',
  withheld: false, sourceType: 'coordinator_order', sourceMessageId: null, at: '2026-11-20T09:00:00.000Z', command: null,
};

for (const [scope, label] of [['named-session-id', 'Planner'], ['missing-session-id', 'missing…']]) {
  test(`the memory rail and overlay show session ${label} for scope ${scope}`, async () => {
    const store = new Store();
    const data = {
      ...store.getSnapshot(), loaded: true, sessions: [session, { ...session, id: 'named-session-id', name: 'Planner' }],
      memory: new Map([['s1', memory]]), memoryItems: new Map([['s1', [{ ...item, scope: { kind: 'session' as const, key: scope } }]]]),
    };
    const now = Date.parse('2026-11-20T09:25:00.000Z');
    const size = { width: 160, height: 30 };
    const view = sessionView({ data, ui: { ...initial, sessionId: 's1', pane: 'memory' }, ...size, now, phase: 0, click: () => undefined });
    const ui = await mountHeadless(h(Screen, {}, view.render()), size);
    try {
      await ui.settle();
      assert.ok(ui.frame().includes(`session ${label}`), ui.frame());
      const overlay = memoryViewport(size, { data, sessionId: 's1', index: 0, now }, displayWidth);
      const text = overlay.lines.map(line => line.map(part => part.text).join('')).join('\n');
      assert.ok(text.includes(`session ${label}`), text);
      assert.equal(text.includes(scope), false, 'the raw scope id is not used as the label');
    } finally { ui.destroy(); store.dispose(); }
  });
}
