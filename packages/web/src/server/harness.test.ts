import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const failure of ['launch', 'close', 'none']) {
  test(`browser harness cleans its temporary directory and servers (${failure})`, () => {
    const source = `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      import { chromium } from 'playwright-core';
      const [failure] = process.argv.slice(1);
      const original = fs.mkdtempSync;
      let directory;
      fs.mkdtempSync = (...args) => { directory = original(...args); return directory; };
      syncBuiltinESMExports();
      chromium.launch = async () => {
        if (failure === 'launch') throw new Error('launch failed');
        return { close: async () => { if (failure === 'close') throw new Error('close failed'); } };
      };
      const { startRig } = await import('./packages/web/e2e/harness.ts');
      if (failure === 'launch') await assert.rejects(startRig(), /launch failed/);
      else {
        const rig = await startRig();
        if (failure === 'close') await assert.rejects(rig.close(), /close failed/);
        else await rig.close();
      }
      assert.equal(fs.existsSync(directory), false);
      // Exiting without a timeout also proves no server/timer was left running.
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source, failure], {
      cwd: new URL('../../../..', import.meta.url), encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.status, 0, result.stderr);
  });
}
