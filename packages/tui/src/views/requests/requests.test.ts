import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '@pi-console/testkit';
import type { Request, Session } from '@pi-console/contract';
import { Store } from '../../store/store.ts';
import { initial } from '../../state/ui.ts';
import { Screen, h, mountHeadless } from '../../view/renderer.ts';
import { requestsView } from './requests.ts';

const fixture = generate().fixture as unknown as { requests: Request[]; sessions: Session[] };
const sessions = fixture.sessions.map(session => ({ ...session, name: 'A readable session with a deliberately long name', laneId: 'lane-220' }));
const requests: Request[] = ['human', 'launch', 'unproven'].map((origin, index) => ({ ...fixture.requests[0], id: `r${String(index)}`, origin: origin as Request['origin'], text: 'TEXT-FREE-SPACE for the actual request', status: 'answered', uncertain: true, uncertainReason: 'shared-answer', answerPossiblyUnseen: true }));

for (const width of [80, 100, 110, 120, 140, 160]) {
  test(`Requests gives text free width without hiding origin or uncertainty at ${String(width)} columns`, async () => {
    const store = new Store();
    const view = requestsView({ data: { ...store.getSnapshot(), requests, sessions }, ui: { ...initial, section: 'requests' }, width, height: 30, now: Date.parse(fixture.requests[0].createdAt), phase: 0, click: () => undefined });
    const ui = await mountHeadless(h(Screen, {}, view.render()), { width, height: 30 });
    try {
      await ui.settle();
      const frame = ui.frame();
      assert.match(frame, /● human · ◆ launch · \* unproven · ≈ uncertain · ◌ unseen\?/);
      assert.equal(frame.includes('Provenance'), width >= 110);
      const rows = frame.split('\n').filter(line => line.includes('≈◌'));
      assert.equal(rows.length, 3);
      assert.ok(rows.every(line => line.includes('TEXT-FREE-SPACE for the')));
      assert.ok(rows.every(line => line.includes('lane-220')));
      for (const glyph of ['●', '◆', '*']) assert.ok(rows.some(line => line.includes(` ${glyph} ≈◌`)));
      assert.equal(view.length, 3);
      assert.equal(view.rowAt(0).sessionId, requests[0].sessionId);
    } finally { ui.destroy(); store.dispose(); }
  });
}
