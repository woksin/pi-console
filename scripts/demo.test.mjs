import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { startDemo } from './demo.mjs';

test('demo is authenticated, synthetic, ingestion-free and removes its private data on close', async () => {
  const demo = await startDemo();
  const url = `http://127.0.0.1:${demo.port}`;
  try {
    assert.equal(statSync(demo.directory).mode & 0o777, 0o700);
    assert.equal(statSync(demo.tokenFile).mode & 0o777, 0o600);
    assert.equal((await globalThis.fetch(`${url}/api/v1/sessions`)).status, 401);
    const headers = { Authorization: `Bearer ${readFileSync(demo.tokenFile, 'utf8').trim()}` };
    const get = async path => {
      const response = await globalThis.fetch(`${url}/api/v1/${path}`, { headers });
      assert.equal(response.status, 200, path);
      return response.json();
    };
    const sessions = await get('sessions');
    assert.equal(sessions.items.length, 30);
    assert.ok(sessions.items.every(session => session.cwd.startsWith('/synthetic/')));
    assert.ok((await get('requests')).items.length > 0);
    assert.ok((await get('questions')).items.length > 0);
    assert.ok((await get('messages')).items.length > 0);
    assert.ok((await get('jobs')).items.length > 0);
    assert.ok((await get('sessions/s2/transcript')).items.length > 0);
    const settings = await get('settings');
    assert.ok(settings.sources.every(source => !source.enabled));
    assert.equal((await get('health')).projection.skipped, 0);
  } finally { await demo.close(); }
  assert.equal(existsSync(demo.directory), false);
  await assert.rejects(globalThis.fetch(`${url}/api/v1/health`));
});
