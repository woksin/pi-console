import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startRig } from './harness.ts';

test('canonical lane-only graph shows directed counts without session links and refreshes after a message', async () => {
  const rig = await startRig({ speed: 1e-9 });
  const fixture = rig.daemon.store.fixture;
  const message = fixture.messages[0];
  fixture.sessions = [];
  fixture.messages = [
    { ...message, id: 'lane-m1', fromSessionId: 'L0', toSessionId: 'L192', sentAt: '2026-01-01T00:00:01Z' },
    { ...message, id: 'lane-m2', fromSessionId: 'L0', toSessionId: 'L192', sentAt: '2026-01-01T00:00:03Z' },
    { ...message, id: 'lane-m3', fromSessionId: 'L192', toSessionId: 'L0', sentAt: '2026-01-01T00:00:02Z' },
  ];
  const page = await rig.open('/messages');
  try {
    await page.getByRole('list', { name: 'Messages', exact: true }).waitFor();
    await page.getByRole('button', { name: /^Graph/ }).click();
    const lanes = page.getByRole('region', { name: 'Lane communication' });
    const forward = lanes.locator('path.edge[data-from="L0"][data-to="L192"]');
    await forward.waitFor();
    assert.equal(await forward.locator('title').textContent(), 'message 2×');
    assert.equal(await lanes.locator('path.edge[data-from="L192"][data-to="L0"] title').textContent(), 'message 1×');
    assert.equal(await forward.evaluate(edge => {
      const ref = edge.getAttribute('marker-end')?.slice(5, -1);
      return ref ? document.getElementById(decodeURIComponent(ref))?.localName : null;
    }), 'marker', 'the direction marker resolves to its SVG definition');
    assert.deepEqual(await lanes.locator('.node .label').allTextContents(), ['L0', 'L192']);
    assert.equal(await lanes.getByRole('link').count(), 0, 'lane-only ids never become session links');
    assert.equal(await page.getByRole('region', { name: 'Session relationships' }).count(), 0);
    rig.daemon.store.publish('message.sent', { ...fixture.messages[0], id: 'lane-m4' });
    await forward.filter({ hasText: 'message 3×' }).waitFor();
    await page.keyboard.press('t');
    const slider = page.getByRole('slider', { name: 'Time scrubber' });
    await slider.fill(await slider.getAttribute('min') ?? '0');
    assert.equal(await forward.count(), 0, 'last-activity cutoff removes the newer edge');
  } finally { await page.context().close(); await rig.close(); }
});

test('sessions sharing a lane stay distinct only in the separate spawn relationship graph', async () => {
  const rig = await startRig({ speed: 1e-9 });
  const fixture = rig.daemon.store.fixture;
  const base = fixture.sessions[0];
  fixture.sessions = [
    { ...base, id: 'parent', laneId: 'L0', role: 'orchestrator', parentSessionId: null, orchestratorSessionId: 'parent' },
    { ...base, id: 'child', laneId: 'L192', role: 'subagent', parentSessionId: 'parent', orchestratorSessionId: 'parent' },
    { ...base, id: 'sibling', laneId: 'L192', role: 'subagent', parentSessionId: 'parent', orchestratorSessionId: 'parent' },
  ];
  fixture.messages = [{ ...fixture.messages[0], fromSessionId: 'parent', toSessionId: 'child' }];
  const page = await rig.open('/messages?view=graph');
  try {
    const lanes = page.getByRole('region', { name: 'Lane communication' });
    await lanes.locator('.node').nth(1).waitFor();
    assert.equal(await lanes.locator('.node').count(), 2);
    const sessions = page.getByRole('region', { name: 'Session relationships' });
    assert.equal(await sessions.getByRole('link').count(), 3);
    assert.equal(await sessions.locator('path.edge.spawn').count(), 2);
    assert.equal(await sessions.locator('path.edge.message').count(), 0);
    await sessions.getByRole('link', { name: new RegExp(`${base.name} · L0`) }).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/#/session/parent');
  } finally { await page.context().close(); await rig.close(); }
});

test('default mock graph groups six repositories with named nodes, a plain legend and one compact toolbar', async () => {
  const rig = await startRig({ speed: 1e-9 });
  const page = await rig.open('/messages?view=graph');
  try {
    const lanes = page.getByRole('region', { name: 'Lane communication' });
    await lanes.locator('svg.graph').nth(5).waitFor();
    assert.equal(await lanes.locator('svg.graph').count(), 6);
    assert.deepEqual(await lanes.locator('svg.graph').evaluateAll(graphs => graphs.map(graph => graph.querySelectorAll('.node').length)), [5, 5, 5, 5, 5, 5]);
    assert.ok(await lanes.locator('.node .label.name', { hasText: 'harbor coordinator' }).count() > 0);
    assert.ok(await lanes.locator('.node title', { hasText: 'L196 · harbor coordinator' }).count() > 0);
    const legend = page.getByRole('list', { name: 'Graph legend' });
    for (const text of ['Messages sent', 'Started a session', 'Waiting for', 'Blocked by', 'Thicker lines mean more messages.']) assert.match(await legend.innerText(), new RegExp(text));
    await page.keyboard.press('t');
    const slider = page.getByRole('slider', { name: 'Time scrubber' });
    const toolbar = page.locator('.graph-toolbar');
    const [button, range] = await Promise.all([toolbar.getByRole('button').boundingBox(), slider.boundingBox()]);
    assert.ok(button && range && Math.abs(button.y - range.y) < button.height, 'toggle and range share one row');
    assert.ok(range.width <= 200, 'the scrubber is compact');
    for (const bounds of await lanes.locator('.node text').evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); const svg = (node.closest('svg') ?? node).getBoundingClientRect(); return [box.left - svg.left, svg.right - box.right, svg.bottom - box.bottom]; }))) {
      assert.ok(bounds.every(edge => edge >= -1), `label stays inside its drawing: ${bounds.join(',')}`);
    }
  } finally { await page.context().close(); await rig.close(); }
});
