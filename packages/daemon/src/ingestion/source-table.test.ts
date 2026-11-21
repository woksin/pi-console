import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { discoverFiles } from './discover-files.ts';
import { sourceTable } from './source-table.ts';

const sources = sourceTable({ agentRoot: 'agent', orchRoot: 'orch', lanesRoot: 'lanes', laneStatusDir: 'status' });
const names = ['item.json', 'lanes.json', 'L192.status', 'events.jsonl', 'registry.jsonl', 's1.jsonl', '2026-11-20.jsonl'];

for (const source of sources) for (const [index, template] of source.feeds.entries()) {
  const directory = relative(process.cwd(), template.directories[0]);
  const components = directory.split(sep);
  for (let depth = 1; depth <= components.length; depth++) {
    const ancestor = join(...components.slice(0, depth));
    test(`${source.id} feed ${String(index)} ${depth === 1 ? 'accepts a configured-root' : 'rejects a descendant'} symlink at ${ancestor}`, t => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-console-source-roots-')));
      t.after(() => { rmSync(root, { recursive: true, force: true }); });
      const spec = sourceTable({ agentRoot: join(root, 'agent'), orchRoot: join(root, 'orch'), lanesRoot: join(root, 'lanes'), laneStatusDir: join(root, 'status') }).find(spec => spec.id === source.id)!;
      const feed = spec.feeds[index];
      const path = feed.directories[0];
      const name = names.find(name => name.endsWith(feed.extension) && (!feed.name || feed.name.test(name)))!;
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, name), '{}\n');
      assert.deepEqual(discoverFiles(path, feed, 0), [join(path, name)]);
      const link = join(root, ancestor);
      const target = join(root, 'target');
      renameSync(link, target);
      symlinkSync(target, link);
      const resolved = sourceTable({ agentRoot: join(root, 'agent'), orchRoot: join(root, 'orch'), lanesRoot: join(root, 'lanes'), laneStatusDir: join(root, 'status') }).find(spec => spec.id === source.id)!.feeds[index];
      const expected = depth === 1 ? [join(target, ...components.slice(1), name)] : [];
      assert.deepEqual(discoverFiles(resolved.directories[0], resolved, 0), expected);
      if (depth === 1) assert.equal(resolved.directories[0], join(target, ...components.slice(1)));
    });
  }
}
