import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resolve } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';
import { apiV0Schema, type Job, type Session } from '@pi-console/contract';
import { generate } from '@pi-console/testkit';
import { sessionViewModel, type SessionViewModel } from '@pi-console/viewmodels';

let server: ViteDevServer;
let SessionRail: ComponentType<{ view: SessionViewModel }>;
before(async () => {
  server = await createServer({
    configFile: false, root: resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom',
    // Memory's external store is unrelated to the rail's job-status rendering.
    plugins: [{
      name: 'session-memory-stub', enforce: 'pre',
      transform: (_source, id) => id.endsWith('/src/views/session-memory.tsx') ? 'export function SessionMemory() { return null; }' : null,
    }],
  });
  ({ SessionRail } = await server.ssrLoadModule('/src/views/session-rail.tsx'));
});
after(async () => { await server.close(); });

test('session rail renders every contract job status, including a muted Queued badge', () => {
  const session = (generate().fixture as unknown as { sessions: Session[] }).sessions[0];
  const statuses = (apiV0Schema.$defs.job as { properties: { status: { enum: Job['status'][] } } }).properties.status.enum;
  const jobs: Job[] = statuses.map(status => ({ id: status, sessionId: session.id, name: `${status} job`, kind: 'job', status, startedAt: session.updatedAt, exitCode: null }));
  const vm = sessionViewModel({ detail: { session, jobs, requests: [], questions: [], resets: [], subagents: [] }, transcript: [], now: Date.parse(session.updatedAt) });
  const html = renderToStaticMarkup(createElement(SessionRail, { view: vm }));
  for (const status of statuses) assert.ok(html.includes(`data-status="${status}"`), `${status} badge is visible`);
  assert.match(html, /class="badge tone-muted" data-status="queued" title="Queued"/);
  assert.match(html, /aria-hidden="true">◷<\/span><span class="badge-label">Queued<\/span>/);
  assert.doesNotMatch(html, /Unknown/);
});
