import { startRig } from './harness.ts';
const rig = await startRig();
const page = await rig.open('/overview');
await page.locator('[data-reason="open-request"] a', { hasText: 'Open in session' }).first().click();
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(1000);
  console.log(page.url(), await page.locator('.tline').count(), await page.locator('.tline.target').count(),
    await page.evaluate(() => { const e = document.querySelector('.tline.target'); if (!e) return null; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return [r.top, r.height, r.width, s.visibility, s.display, s.opacity]; }));
}
await rig.close();
