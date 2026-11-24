import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '@pi-console/testkit';
import type { Session } from '@pi-console/contract';
import { Store } from '../store/store.ts';
import { initial } from '../state/ui.ts';
import { Screen, h, mountHeadless } from '../view/renderer.ts';
import { timelineView } from './timeline.ts';

for (const [span, label] of [[300000, '5m'], [7341000, '2h 2m'], [10800000, '3h'], [97200000, '1d 3h'], [172800000, '2d']] as const) {
  test(`timeline window uses the compact duration ${label}`, async () => {
    const store = new Store();
    const { fixture } = generate();
    const size = { width: 120, height: 30 };
    const view = timelineView({
      data: { ...store.getSnapshot(), loaded: true, sessions: fixture.sessions as unknown as Session[] },
      ui: { ...initial, section: 'timeline', window: { start: Date.parse(fixture.generatedAt), span } },
      ...size, now: Date.parse(fixture.generatedAt), phase: 0, click: () => undefined,
    });
    const ui = await mountHeadless(h(Screen, {}, view.render()), size);
    try {
      await ui.settle();
      assert.ok(ui.frame().includes(`Timeline · window ${label}`));
      assert.doesNotMatch(ui.frame(), /window \d{4,}s/);
    } finally { ui.destroy(); store.dispose(); }
  });
}
