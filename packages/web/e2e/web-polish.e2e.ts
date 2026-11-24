import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { type Rig, startRig } from './harness.ts';

let rig: Rig;
before(async () => { rig = await startRig({ speed: 0.000000001 }); });
after(async () => { await rig.close(); });

test('settings groups daemon health into Sources, Event log and Stream with raw values under Details', async () => {
  const page = await rig.open('/settings');
  try {
    const health = page.locator('.health-panel');
    await health.waitFor();
    for (const name of ['Sources', 'Event log', 'Stream']) await health.getByRole('region', { name }).waitFor();
    assert.equal(await health.getByText(/Sources · \d/).count(), 0);
    const details = health.locator('details.health-details');
    assert.equal(await details.evaluate(node => (node as HTMLDetailsElement).open), false);
    await details.locator('summary').click();
    assert.equal(await details.evaluate(node => (node as HTMLDetailsElement).open), true);
    await details.getByText('Last sequence').first().waitFor();
  } finally { await page.context().close(); }
});

test('fleet cost never collides with the Age column and long model names disclose in full', async () => {
  const page = await rig.open('/fleet', { width: 1280, height: 800 });
  try {
    await page.locator('table[aria-label="Fleet"] tbody tr.row').first().waitFor();
    const overlaps = await page.locator('table[aria-label="Fleet"] tbody tr.row').evaluateAll(rows => rows.flatMap(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      const cost = cells[5];
      const age = cells[6];
      const text = cost.querySelector('span');
      return text && text.getBoundingClientRect().right > age.getBoundingClientRect().left ? [cost.textContent] : [];
    }));
    assert.deepEqual(overlaps, []);
    const partial = page.locator('td.cost-cell[title^="Partial cost"]').first();
    if (await partial.count() > 0) {
      assert.match(await partial.locator('span').first().innerText(), /^≥\$\d/);
      assert.match(await partial.locator('.sr-only').innerText(), /at least/);
    }
    assert.equal(await page.locator('td.truncate[title]').first().evaluate(node => node.getAttribute('title') === node.textContent), true);
  } finally { await page.context().close(); }
});

test('requests show no default chips and keep the filters on one desktop row that wraps intentionally when narrow', async () => {
  const page = await rig.open('/requests', { width: 1280, height: 800 });
  try {
    const summary = page.getByTestId('request-summary');
    await summary.waitFor();
    for (const chip of ['state all', 'origin all', 'session all']) assert.equal(await summary.getByText(chip, { exact: true }).count(), 0);
    const tops = () => page.locator('.request-filters').locator('label').evaluateAll(labels => new Set(labels.map(label => Math.round(label.getBoundingClientRect().top))).size);
    assert.equal(await tops(), 1, 'desktop filters share one row');
    await page.getByLabel('State').selectOption('open');
    await summary.getByText('state open', { exact: true }).waitFor();
    await page.setViewportSize({ width: 600, height: 800 });
    for (const label of ['State', 'Origin', 'Session']) {
      assert.equal(await page.getByLabel(label).evaluate(node => { const rect = node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; }), true, `${label} stays visible`);
    }
  } finally { await page.context().close(); }
});
