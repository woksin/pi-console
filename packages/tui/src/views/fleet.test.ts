import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '@pi-console/testkit';
import type { Session } from '@pi-console/contract';
import { displayWidth } from '@pi-console/viewmodels';
import { Store } from '../store/store.ts';
import { initial } from '../state/ui.ts';
import { Screen, h, mountHeadless } from '../view/renderer.ts';
import { fleetView } from './fleet.ts';

const base = (generate().fixture as unknown as { sessions: Session[] }).sessions[0];
const parent: Session = { ...base, id: 'parent', name: 'parent worker', status: 'working', parentSessionId: null };
const child: Session = { ...base, id: 'child', name: 'child worker', status: 'needs-you', parentSessionId: parent.id, role: 'subagent' };

for (const width of [80, 120, 139, 140, 160]) {
  test(`Fleet aligns status after indented names at ${String(width)} columns`, async () => {
    const store = new Store();
    const view = fleetView({ data: { ...store.getSnapshot(), loaded: true, sessions: [parent, child] }, ui: { ...initial, section: 'fleet' }, width, height: 24, now: Date.parse(base.updatedAt), phase: 0, click: () => undefined });
    const ui = await mountHeadless(h(Screen, {}, view.render()), { width, height: 24 });
    try {
      await ui.settle();
      const frame = ui.frame();
      assert.match(frame, /Name\s+Status\s+Ctx\s+(?:Trend\s+)?Cost\s+Age/);
      const lines = frame.split('\n');
      const main = lines.find(line => line.includes('parent worker')) ?? '';
      const sub = lines.find(line => line.includes('child worker')) ?? '';
      assert.match(sub, /└/);
      assert.equal(main.indexOf('Working'), sub.indexOf('Needs you'));
      assert.equal(frame.includes('Selected'), width >= 140);
      if (width >= 140) assert.match(frame, /2 sessions[\s\S]*1 need attention/);
      assert.deepEqual(view.rowAt(2), { sessionId: child.id, groupId: null });
    } finally { ui.destroy(); store.dispose(); }
  });
}

for (const width of [40, 60]) {
  test(`Fleet at ${String(width)} columns fits Unicode names and explains hidden columns`, async () => {
    const store = new Store();
    const sessions = [{ ...parent, name: '界😀e\u0301' }, { ...child, name: '🇳🇴' }];
    const view = fleetView({ data: { ...store.getSnapshot(), loaded: true, sessions }, ui: { ...initial, section: 'fleet' }, width, height: 24, now: Date.parse(base.updatedAt), phase: 0, click: () => undefined });
    const ui = await mountHeadless(h(Screen, {}, view.render()), { width, height: 24 });
    try {
      await ui.settle();
      const frame = ui.frame();
      const lines = frame.split('\n');
      const main = lines.find(line => line.includes('Working')) ?? '';
      const sub = lines.find(line => line.includes('Needs you')) ?? '';
      assert.match(main, /界😀e\u0301/);
      assert.match(sub, /🇳🇴/);
      assert.equal(displayWidth(main.slice(0, main.indexOf('Working'))), displayWidth(sub.slice(0, sub.indexOf('Needs you'))));
      for (const line of lines) assert.ok(displayWidth(line) <= width);
      if (width === 40) {
        assert.match(frame, /\+cost age hidden — widen terminal/);
        assert.doesNotMatch(frame, /\bCost\s+Age\b/);
      } else {
        assert.match(frame, /\bCost\s+Age\b/);
        assert.doesNotMatch(frame, /hidden — widen terminal/);
      }
    } finally { ui.destroy(); store.dispose(); }
  });
}

test('an empty fleet shows the shared empty state and the first-run checklist', async () => {
  const store = new Store();
  const view = fleetView({ data: { ...store.getSnapshot(), loaded: true, sessions: [] }, ui: { ...initial, section: 'fleet' }, width: 100, height: 30, now: Date.parse(base.updatedAt), phase: 0, click: () => undefined });
  const ui = await mountHeadless(h(Screen, {}, view.render()), { width: 100, height: 30 });
  try {
    await ui.settle();
    const frame = ui.frame();
    assert.match(frame, /No pi sessions found yet\./);
    assert.match(frame, /Getting started/);
    assert.match(frame, /○ Daemon running \(not yet\)/);
    assert.match(frame, /◇ Extension installed \(optional\)/);
  } finally { ui.destroy(); store.dispose(); }
});
