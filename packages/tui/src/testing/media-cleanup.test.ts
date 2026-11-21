import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../../../..', import.meta.url);
function child(source: string, args: string[] = [], flags: string[] = []): ReturnType<typeof spawnSync> {
  const result = spawnSync(process.execPath, [...flags, '--input-type=module', '-e', source, ...args], { cwd: root, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr);
  return result;
}

const setup = `
  import fs from 'node:fs';
  import cp from 'node:child_process';
  import { syncBuiltinESMExports } from 'node:module';
  const [directory] = process.argv.slice(1);
`;

test('media --only starts with an empty work directory', t => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-media-only-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  child(setup + `
    import { chromium } from 'playwright-core';
    let cleaned = false;
    const rm = fs.rmSync, mkdir = fs.mkdirSync;
    fs.rmSync = (path, ...args) => { if (path.endsWith('/.ai-work/media-work')) cleaned = true; else rm(path, ...args); };
    fs.mkdirSync = (path, ...args) => { if (!path.endsWith('/.ai-work/media-work')) return mkdir(path, ...args); };
    cp.spawnSync = () => ({ status: 0 });
    chromium.launch = async () => {
      if (!cleaned) throw new Error('stale work was not cleaned before capture');
      return { newContext: async () => ({ newPage: async () => ({}), close: async () => {} }), close: async () => {} };
    };
    syncBuiltinESMExports();
    process.argv = ['node', 'media', '--only', 'not-a-shot'];
    await import('./scripts/media/index.mjs');
  `, [directory]);
});

test('unselected hero capture does not start a browser or write work files', t => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-media-hero-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  child(setup + `
    const { captureHero } = await import('./scripts/media/hero.ts');
    await captureHero({ browser: { newContext: async () => { throw new Error('unselected hero opened a context'); } } }, { dir: directory, only: 'tui' });
    if (fs.readdirSync(directory).length) throw new Error('unselected hero wrote work files');
  `, [directory]);
});

for (const only of ['hero-dark', 'hero-light', 'hero']) {
  test(`partial ${only} capture recreates its inputs in a clean work directory`, t => {
    const directory = mkdtempSync(join(tmpdir(), 'pi-media-hero-inputs-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    child(setup + `
      import assert from 'node:assert/strict';
      import { mock } from 'node:test';
      const [only] = process.argv.slice(2);
      const sources = [];
      const capture = async (_rig, work) => { sources.push(work.only); fs.writeFileSync(directory + '/' + work.only + '.png', 'synthetic'); };
      mock.module('./scripts/media/web.ts', { namedExports: { captureWeb: capture } });
      mock.module('./scripts/media/tui.ts', { namedExports: { captureTui: capture } });
      const { captureHero } = await import('./scripts/media/hero.ts');
      const page = { setContent: async () => {}, screenshot: async () => Buffer.from('hero') };
      const context = { newPage: async () => page, close: async () => {} };
      await captureHero({ browser: { newContext: async () => context } }, { dir: directory, only });
      const themes = ['dark', 'light'].filter(theme => ('hero-' + theme).startsWith(only));
      assert.deepEqual(sources, [...themes.map(theme => theme === 'dark' ? 'web-overview' : 'web-overview-light'), 'tui-overview']);
      for (const theme of themes) assert.equal(fs.readFileSync(directory + '/hero-' + theme + '.png', 'utf8'), 'hero');
    `, [directory, only], ['--experimental-test-module-mocks']);
  });
}

for (const step of ['scale', 'webp']) {
  test(`encoder removes temporary files when ${step} fails`, t => {
    const directory = mkdtempSync(join(tmpdir(), 'pi-media-encode-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    child(setup + `
      import assert from 'node:assert/strict';
      const [step] = process.argv.slice(2);
      const png = directory + '/still.png';
      const out = directory + '/out.webp';
      fs.writeFileSync(png, 'original');
      let calls = 0;
      cp.spawnSync = (_command, args) => {
        calls++;
        fs.writeFileSync(args.at(-1), 'partial');
        return { status: calls === (step === 'webp' ? 2 : 1) ? 1 : 0, stderr: 'injected failure' };
      };
      syncBuiltinESMExports();
      const { encodeStill } = await import('./scripts/media/encode.mjs');
      assert.throws(() => encodeStill(png, out, 10), /injected failure/);
      assert.equal(fs.existsSync(out + '.png'), false);
      assert.equal(fs.readFileSync(png, 'utf8'), 'original');
    `, [directory, step]);
  });
}

test('failed TUI browser setup cleans the already-launched PTY', { skip: process.platform === 'win32' }, () => {
  child(`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const original = fs.mkdtempSync;
    let directory;
    fs.mkdtempSync = (...args) => { directory = original(...args); return directory; };
    syncBuiltinESMExports();
    const { captureTui } = await import('./scripts/media/tui.ts');
    const rig = { daemon: { port: 9, token: 'synthetic' }, browser: { newContext: async () => { throw new Error('context failed'); } } };
    await assert.rejects(captureTui(rig, { dir: '', only: 'tui-overview' }), /context failed/);
    assert.equal(fs.existsSync(directory), false);
  `);
});

test('PTY normal exit preserves the status and final output while cleaning resources', { skip: process.platform === 'win32' }, () => {
  child(`
    import assert from 'node:assert/strict';
    const { startPty } = await import('./packages/tui/src/testing/pty.ts');
    const pty = startPty('printf ready; exit 7', { cols: 80, rows: 24, env: process.env });
    try {
      assert.equal(await pty.exit, 7);
      assert.match(pty.screen(), /ready/);
      pty.kill();
      assert.equal(await pty.exit, 7);
    } finally { pty.kill(); }
  `);
});

test('PTY kill settles exit and cleans the parent resources even without a status file', { skip: process.platform === 'win32' }, () => {
  child(`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const original = fs.mkdtempSync;
    let directory;
    fs.mkdtempSync = (...args) => { directory = original(...args); return directory; };
    syncBuiltinESMExports();
    const { startPty } = await import('./packages/tui/src/testing/pty.ts');
    const pty = startPty('printf ready; sleep 30', { cols: 80, rows: 24, env: process.env });
    try {
      await pty.waitFor('ready', 2000);
      pty.kill();
      pty.kill();
      assert.notEqual(await pty.exit, 0);
      assert.equal(fs.existsSync(directory), false);
    } finally { pty.kill(); }
  `);
});
