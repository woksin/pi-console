import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteEventLog } from '@pi-console/core';
import { SourceIngestion } from './source-ingestion.ts';
import type { Feed } from './source-table.ts';

for (const failedDiscovery of [false, true]) {
  test(`rotated snapshot paths are forgotten only after complete discovery (failure=${String(failedDiscovery)})`, async t => {
    const root = mkdtempSync(join(tmpdir(), 'pi-console-seen-'));
    const log = new SqliteEventLog(join(root, 'console.db'));
    t.after(() => { log.close(); rmSync(root, { recursive: true, force: true }); });
    const watched = join(root, 'watched');
    mkdirSync(watched);
    const late = join(root, 'late');
    mkdirSync(late);
    let mapped = 0;
    const feed: Feed = { kind: 'snapshot', directories: [watched], extension: '.json', window: 'none', mapper: () => { mapped++; return []; } };
    const worker = new SourceIngestion(log, { id: 'question-store', feeds: [feed, { ...feed, directories: [late] }], backfillWindowDays: 14 });
    t.after(() => worker.close());
    for (let i = 0; i < 3; i++) {
      const file = join(watched, `rotating-${String(i)}.json`);
      const away = join(root, `away-${String(i)}.json`);
      writeFileSync(file, '{"v":1}');
      utimesSync(file, 1_700_000_000, 1_700_000_000);
      const original = statSync(file);
      await worker.poll();
      const before = mapped;
      renameSync(file, away);
      if (failedDiscovery) {
        rmSync(late, { recursive: true });
        writeFileSync(late, 'not a directory');
        await assert.rejects(worker.poll(), /ENOTDIR/);
        rmSync(late);
        mkdirSync(late);
      } else await worker.poll();
      renameSync(away, file);
      writeFileSync(file, '{"v":2}');
      utimesSync(file, original.atime, original.mtime);
      assert.equal(statSync(file).size, original.size);
      await worker.poll();
      assert.equal(mapped, before + (failedDiscovery ? 0 : 1));
    }
  });
}
