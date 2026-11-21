import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate opens so even a blocking-open regression is killed; an in-process timeout cannot interrupt openSync.
const raceScript = `
  import fs from 'node:fs';
  import promises from 'node:fs/promises';
  import { syncBuiltinESMExports } from 'node:module';
  import { dirname } from 'node:path';
  import { spawnSync } from 'node:child_process';
  import { FileTailer, pollSnapshot } from '@pi-console/adapters';
  import { discoverFiles } from './packages/daemon/src/ingestion/discover-files.ts';
  import { MemoryLog } from './packages/adapters/src/tailing/memory-log.test.ts';
  const [path, outside, mode, replacement] = process.argv.slice(1);
  const root = fs.realpathSync(dirname(dirname(path)));
  const feed = { kind: mode, extension: '.jsonl', directories: [dirname(path)], ancestors: [dirname(path)] };
  const [discovered] = discoverFiles(dirname(path), feed, 0);
  if (discovered !== path) throw new Error('File was not discovered');
  const canonical = fs.realpathSync(path);
  let replaced = false;
  let opened = 0;
  let closed = 0;
  const replacements = {
    fifo: () => { if (spawnSync('mkfifo', [path]).status !== 0) throw new Error('mkfifo failed'); },
    symlink: () => fs.symlinkSync(outside, path),
    directory: () => fs.mkdirSync(path),
    oversize: () => fs.writeFileSync(path, 'x'.repeat(2048)),
  };
  function replace(candidate) {
    if (replaced) return;
    if (candidate !== path && candidate !== canonical) return;
    replaced = true;
    if (replacement === 'normal') return;
    if (replacement === 'ancestor') {
      fs.renameSync(dirname(path), dirname(path) + '-moved');
      fs.symlinkSync(dirname(path) + '-moved', dirname(path));
      return;
    }
    fs.rmSync(path);
    replacements[replacement]();
  }
  const originalSync = fs.openSync;
  fs.openSync = (candidate, ...args) => { replace(candidate); return originalSync(candidate, ...args); };
  const originalAsync = promises.open;
  promises.open = async (candidate, ...args) => {
    replace(candidate);
    const handle = await originalAsync(candidate, ...args);
    opened++;
    const close = handle.close.bind(handle);
    handle.close = async () => { await close(); closed++; };
    return handle;
  };
  syncBuiltinESMExports();
  const log = new MemoryLog();
  const mapper = () => [{ type: 'SessionHeartbeat', subject: 'session:fixture', payload: { sessionId: 'fixture', status: 'ok' } }];
  const tailer = new FileTailer(log, 'intent-memory', mapper, { roots: [root], batchBytes: 1024 });
  let appended = 0;
  try {
    if (mode === 'snapshot') appended = await pollSnapshot(log, 'intent-memory', discovered, mapper, { roots: [root], resolvedRoots: [root], maxBytes: 1024 });
    else appended = (await tailer.poll([discovered])).appended;
  } catch { /* Ingestion skips a rejected file without persisting any bytes or checkpoint. */ }
  finally { await tailer.close(); }
  process.stdout.write(JSON.stringify({ replaced, appended, checkpoints: log.positions.length, unclosed: opened - closed }));
`;

for (const mode of ['tail', 'snapshot']) {
  for (const replacement of ['fifo', 'symlink', 'directory', 'ancestor', 'oversize', 'normal']) {
    test(`${mode} feed validates ${replacement} replacement between discovery and open`, { timeout: 5000, skip: process.platform === 'win32' }, t => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-file-open-')));
      const outside = mkdtempSync(join(tmpdir(), 'pi-file-outside-'));
      t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
      mkdirSync(join(root, 'memory'));
      const path = join(root, 'memory', 'events.jsonl');
      const other = join(outside, 'events.jsonl');
      writeFileSync(path, '{"value":"safe"}\n');
      writeFileSync(other, '{"value":"outside"}\n');
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', raceScript, path, other, mode, replacement], {
        cwd: new URL('../../../..', import.meta.url), encoding: 'utf8', timeout: 2000,
      });
      assert.equal(child.error, undefined, child.error?.message);
      assert.equal(child.status, 0, child.stderr);
      const accepted = replacement === 'normal';
      assert.deepEqual(JSON.parse(child.stdout), { replaced: true, appended: accepted ? 1 : 0, checkpoints: accepted ? 1 : 0, unclosed: 0 });
    });
  }
}
