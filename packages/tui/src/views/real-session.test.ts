import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '@pi-console/contract';
import { displayWidth } from '@pi-console/viewmodels';
import { Store } from '../store/store.ts';
import { initial } from '../state/ui.ts';
import { Screen, h, mountHeadless } from '../view/renderer.ts';
import { fleetView } from './fleet.ts';

const session: Session = {
  id: 'abcdef01-1234', repositoryId: '/work/repo', name: 'repo', laneId: 'unassigned', branch: '', cwd: '/work/repo', role: 'main',
  parentSessionId: null, orchestratorSessionId: 'abcdef01-1234', model: '', status: 'idle', startedAt: '', updatedAt: '', contextPercent: 0, samples: [],
};

for (const width of [80, 140]) {
  test(`real Fleet identity and partial-cost cells fit ${String(width)} columns without placeholder metadata`, async () => {
    const store = new Store();
    const sessions = [session, { ...session, id: 'fedcba98-1234', costUsd: 1.25, costIncomplete: true }];
    const view = fleetView({ data: { ...store.getSnapshot(), loaded: true, sessions }, ui: { ...initial, section: 'fleet', cursor: { ...initial.cursor, fleet: 1 } }, width, height: 24, now: 0, phase: 0, click: () => undefined });
    const ui = await mountHeadless(h(Screen, {}, view.render()), { width, height: 24 });
    try {
      await ui.settle();
      const frame = ui.frame();
      assert.match(frame, /abcdef01 repo/);
      assert.match(frame, /fedcba98 repo/);
      assert.doesNotMatch(frame, /unassigned|\$0\.00/);
      const lines = frame.split('\n');
      assert.ok(lines.every(line => displayWidth(line) <= width));
      const rows = lines.filter(line => line.includes('Idle') && /abcdef01 repo|fedcba98 repo/.test(line));
      assert.equal(rows.length, 2);
      assert.equal(rows[0].indexOf('Idle'), rows[1].indexOf('Idle'));
      if (width === 140) assert.doesNotMatch(frame, /Branch|Lane/);
    } finally { ui.destroy(); store.dispose(); }
  });
}
