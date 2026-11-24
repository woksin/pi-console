import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { type Rig, startRig } from './harness.ts';

let rig: Rig;
before(async () => { rig = await startRig({ speed: 0.000000001 }); });
after(async () => { await rig.close(); });

test('settings groups readable daemon health without repeating sources or sequences under Details', async () => {
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
    await details.getByText('Event loop · P50', { exact: true }).waitFor();
    assert.equal(await details.locator('dt').filter({ hasText: /sequence|Sources/ }).count(), 0);
    assert.equal(await page.locator('.settings dt').filter({ hasText: /sequence/i }).count(), 1);
    await health.getByText('available · 12 files · no lag', { exact: true }).first().waitFor();
    assert.equal(await health.locator('dd .faint.small').count(), 3);
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
    for (const chip of ['State: All', 'Origin: All', 'Session: All']) assert.equal(await summary.getByText(chip, { exact: true }).count(), 0);
    const sameRow = await page.locator('.request-filters').locator('select, input').evaluateAll(controls => {
      const boxes = controls.map(control => control.getBoundingClientRect());
      return boxes.every(box => box.top < Math.min(...boxes.map(other => other.bottom)) && box.bottom > Math.max(...boxes.map(other => other.top)));
    });
    assert.equal(sameRow, true, 'desktop filters share one row');
    await page.getByRole('combobox', { name: 'State', exact: true }).selectOption('open');
    await summary.getByText('State: Open', { exact: true }).waitFor();
    await page.setViewportSize({ width: 600, height: 800 });
    for (const label of ['State', 'Origin', 'Session']) {
      assert.equal(await page.getByRole('combobox', { name: label, exact: true }).evaluate(node => { const rect = node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; }), true, `${label} stays visible`);
    }
  } finally { await page.context().close(); }
});
