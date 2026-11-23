import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { Health, Settings } from '@pi-console/contract';
import { apiV1Schema, validate } from '@pi-console/contract';
import { buildAgentTree, call } from '@pi-console/testkit';
import { loadConfig } from '../config.ts';
import { startDaemon } from '../daemon.ts';
import { loadToken } from '../security/token.ts';

const health = async (running: Running) => { const { body, text } = await running.get('health'); return { body: body as Health, text }; };
const settingsOf = async (running: Running) => { const { body, text } = await running.get('settings'); return { body: body as Settings, text }; };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface Running { get: (path: string) => Promise<{ body: unknown; text: string }> }

async function launch(t: TestContext, relocate: (from: string) => string, stage: string, base: string): Promise<Running> {
  const directory = join(base, 'data');
  mkdirSync(directory, { mode: 0o700 });
  const tree = buildAgentTree(join(stage, 'agent'));
  mkdirSync(join(tree.root, 'memory', 'journal'), { recursive: true }); // The fixture has no intent memory, and an absent directory is reported as missing.
  const live = (path: string) => relocate(path);
  const config = loadConfig(directory, { port: 0, agentRoot: live(tree.root), orchRoot: live(tree.orchRoot), lanesRoot: live(tree.lanesRoot), laneStatusDir: live(tree.laneStatusDir), sessionRoots: [join(live(tree.root), 'sessions')], pollMs: 20 });
  config.sourcePollMs = 20;
  const daemon = await startDaemon(config);
  t.after(async () => { await daemon.close().catch(() => undefined); });
  const token = loadToken(directory);
  const get = async (path: string): Promise<{ body: unknown; text: string }> => {
    const response = await call(daemon.port, `/api/v1/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return { body: response.body, text: JSON.stringify(response.body) };
  };
  return { get };
}

function bases(t: TestContext): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'pi-console-health-')));
  t.after(() => { rmSync(base, { recursive: true, force: true }); });
  return base;
}

test('absent roots degrade health and settings without leaking paths, then clear on their own once the directories appear', async t => {
  const base = bases(t);
  const stage = join(base, 'stage');
  mkdirSync(stage);
  const live = join(base, 'live');
  const running = await launch(t, path => path.replace(stage, live), stage, base);

  const missing = await health(running);
  validate(missing.body, apiV1Schema.$defs.health, apiV1Schema);
  assert.equal(missing.body.status, 'degraded');
  assert.equal(missing.body.agentRootAvailability, 'missing');
  assert.equal(missing.body.sources.find(source => source.source === 'issue-work')?.availability, 'missing');
  assert.equal(missing.text.includes(base), false);
  const settings = await settingsOf(running);
  validate(settings.body, apiV1Schema.$defs.settings, apiV1Schema);
  assert.equal(settings.body.agentRootAvailability, 'missing');
  const issueWork = settings.body.sources.find(source => source.source === 'issue-work');
  assert.deepEqual([issueWork?.enabled, issueWork?.availability], [true, 'missing']);
  assert.equal(settings.text.includes(base), false);
  assert.throws(() => realpathSync(live), { code: 'ENOENT' });

  renameSync(stage, live);
  let recovered = await health(running);
  for (let i = 0; i < 300 && (recovered.body.status !== 'ok' || recovered.body.sources.every(source => source.files === 0)); i++) { await wait(10); recovered = await health(running); }
  assert.equal(recovered.body.agentRootAvailability, 'available');
  assert.ok(recovered.body.sources.every(source => source.availability === 'available'), JSON.stringify(recovered.body.sources));
  assert.equal(recovered.body.status, 'ok');
  assert.ok(((await running.get('questions')).body as { items: { id: string }[] }).items.some(question => question.id === 'q-1'), 'the late source is ingested without a restart');
});
