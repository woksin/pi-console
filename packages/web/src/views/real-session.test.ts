import { after, before, test } from 'node:test';
import { resolve } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import assert from 'node:assert/strict';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Session } from '@pi-console/contract';
import { sessionViewModel, type SessionViewModel } from '@pi-console/viewmodels';
import { webGraphModel } from './graph-model.ts';
import { emptyState } from '../state/state.ts';
import type { TopBar as TopBarComponent } from '../app/shell.tsx';

let server: ViteDevServer;
let SessionHeader: ComponentType<{ view: SessionViewModel }>;
let TopBar: typeof TopBarComponent;
before(async () => {
  server = await createServer({ configFile: false, root: resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  ({ SessionHeader } = await server.ssrLoadModule('/src/views/session-rail.tsx'));
  ({ TopBar } = await server.ssrLoadModule('/src/app/shell.tsx'));
});
after(async () => { await server.close(); });

const session: Session = {
  id: 'abcdef01-1234', repositoryId: '/work/repo', name: 'repo', laneId: 'unassigned', branch: '', cwd: '/work/repo', role: 'main',
  parentSessionId: null, orchestratorSessionId: 'abcdef01-1234', model: '', status: 'idle', startedAt: '', updatedAt: '', contextPercent: 0, samples: [],
};

test('real session headers omit missing metadata and distinguish unknown, zero and partial costs', () => {
  const render = (row: Session) => {
    const detail = { session: row, requests: [], questions: [], jobs: [], resets: [], subagents: [] };
    const view = sessionViewModel({ detail, transcript: [], now: 0 });
    return renderToStaticMarkup(createElement(SessionHeader, { view }));
  };
  const unknown = render(session);
  assert.match(unknown, /\/work\/repo · main/);
  assert.match(unknown, />—<\/span>/);
  assert.doesNotMatch(unknown, /unassigned| · {2}· |\$0\.00/);
  assert.match(render({ ...session, costUsd: 0 }), /\$0\.00/);
  assert.match(render({ ...session, costUsd: 1.25, costIncomplete: true }), /≥\$1\.25/);
});

test('the focused topbar heading uses name-first identity with a secondary lane', () => {
  const render = (row?: Session) => renderToStaticMarkup(createElement(TopBar, {
    title: 'Session', hint: '', state: emptyState(), wall: 0, session: row, onPalette: () => undefined, onHelp: () => undefined,
  }));
  const real = render(session);
  assert.match(real, /<h1 id="content-heading" tabindex="-1" class="crumb truncate" title="abcdef01">abcdef01<\/h1>/);
  assert.doesNotMatch(real, /\/work\/repo|unassigned/);
  const rich = render({ ...session, repositoryId: 'aurora', laneId: 'L1', name: 'aurora worker' });
  assert.match(rich, />aurora worker · L1<\/h1>/);
  assert.match(render(), />Session<\/h1>/);
});

test('graph titles are readable but raw repository grouping keys remain distinct', () => {
  const second = { ...session, id: 'fedcba98-1234', repositoryId: '/other/repo', cwd: '/other/repo' };
  const children = [session, second].map(parent => ({ ...parent, id: `${parent.id}-child`, parentSessionId: parent.id }));
  const view = webGraphModel({ sessions: [session, second, ...children], graph: { nodes: [], edges: [] } });
  assert.deepEqual(view.sessions.map(group => group.title), ['repo', 'repo']);
  assert.deepEqual(view.sessions.map(group => group.id), ['sessions:/work/repo', 'sessions:/other/repo']);
  assert.notEqual(view.sessions[0].nodes[0].label, view.sessions[1].nodes[0].label);
});
