import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resolve } from 'node:path';
import { createElement, type ComponentType, type Context } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type ViteDevServer } from 'vite';
import { generate, needsYou } from '@pi-console/testkit';
import { emptyState, type ConsoleState } from '../state/state.ts';
import { ConsoleStore } from '../client/store.ts';
import type { Api } from '../client/api.ts';
import type { ViewProps } from './view.tsx';
import type { Sidebar as SidebarComponent } from './shell.tsx';
import type { FleetPulse as FleetPulseComponent } from './pulse.tsx';
import { attentionPresentation, attentionTitle, type AttentionPresentation } from './attention.ts';
import { faviconHref } from './favicon.ts';

let server: ViteDevServer;
let OverviewView: ComponentType<ViewProps>;
let Sidebar: typeof SidebarComponent;
let FleetPulse: typeof FleetPulseComponent;
let StoreContext: Context<ConsoleStore | null>;
before(async () => {
  server = await createServer({ configFile: false, root: resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  ({ OverviewView } = await server.ssrLoadModule('/src/views/overview.tsx'));
  ({ Sidebar } = await server.ssrLoadModule('/src/app/shell.tsx'));
  ({ FleetPulse } = await server.ssrLoadModule('/src/app/pulse.tsx'));
  ({ StoreContext } = await server.ssrLoadModule('/src/app/hooks.ts'));
});
after(async () => { await server.close(); });

const fixture = generate(119).fixture;
const item = needsYou(fixture).items[0];
const base = (): ConsoleState => ({ ...emptyState(), connection: 'live', snapshotLoaded: true, sessions: fixture.sessions as ConsoleState['sessions'] });
const store = new ConsoleStore({} as Api);
function render(state: ConsoleState): string {
  return renderToStaticMarkup(createElement(StoreContext.Provider, { value: store },
    createElement(Sidebar, { active: 'overview', settings: false, attention: attentionPresentation(state), questions: 0, collapsed: false, onCollapse: () => undefined }),
    createElement(OverviewView, { state, now: 0 }),
    createElement(FleetPulse, { sessions: state.sessions, attention: attentionPresentation(state) }),
  ));
}

const cases: { status: AttentionPresentation['status']; overrides: Partial<ConsoleState>; label: string }[] = [
  { status: 'checking', overrides: {}, label: 'Checking needs you…' },
  { status: 'unavailable', overrides: { needsYouError: true }, label: 'Needs you unavailable' },
  { status: 'stale', overrides: { needsYouCached: true, needsYouError: true }, label: '0 need you · stale' },
  { status: 'stale', overrides: { needsYouCached: true, needsYouError: true, needsYou: [item] }, label: '1 need you · stale' },
];
for (const { status, overrides, label } of cases) {
  test(`${status}: ${label} is consistent in the title, favicon, sidebar, Overview and pulse`, () => {
    const state = { ...base(), ...overrides };
    const attention = attentionPresentation(state);
    assert.equal(attention.status, status);
    assert.equal(attention.label, label);
    const title = attentionTitle(attention, 'Overview');
    assert.match(title, new RegExp(status === 'checking' ? 'checking' : status));
    assert.match(title, /Overview · pi console$/);
    const icon = decodeURIComponent(faviconHref(attention));
    assert.ok(icon.includes(`<title>${label}</title>`));
    assert.match(icon, /<circle/);
    const html = render(state);
    assert.ok(html.includes(`aria-label="${label}"`), 'sidebar badge names the state');
    assert.ok(html.includes(`class="hero-title">${label}</h2>`), 'Overview names the same state');
    assert.ok(html.includes(`working, ${label};`), 'the pulse also retains the state');
    assert.doesNotMatch(html, /All clear/);
    if (status !== 'stale') {
      assert.equal(attention.count, null);
      assert.doesNotMatch(html, /0 need you|0 waiting/);
      assert.doesNotMatch(title, /\(0\)/);
    } else {
      assert.ok(title.includes(String(attention.count)), 'even a cached zero is shown as stale');
      assert.match(html, />Retry<\/button>/);
      if (attention.count === 1) assert.ok(html.includes(item.text), 'cached cards remain visible');
    }
  });
}

for (const connection of ['connecting', 'reconnecting', 'offline', 'unauthorized'] as const) {
  for (const cached of [[], [item]]) test(`${connection}: a successful cached ${String(cached.length)} is stale in every presentation`, () => {
    const state = { ...base(), connection, needsYou: cached, needsYouLoaded: true, needsYouCached: true };
    const attention = attentionPresentation(state);
    const label = `${String(cached.length)} need you · stale`;
    assert.equal(attention.status, 'stale');
    assert.equal(attention.count, cached.length);
    assert.equal(attentionTitle(attention, 'Overview'), `(${String(cached.length)} stale) Overview · pi console`);
    assert.ok(decodeURIComponent(faviconHref(attention)).includes(`<title>${label}</title>`));
    assert.match(faviconHref(attention), /<circle/);
    const html = render(state);
    assert.ok(html.includes(`aria-label="${label}"`), 'sidebar marks the cached count stale');
    assert.ok(html.includes(`class="hero-title">${label}</h2>`), 'Overview marks the cached count stale');
    assert.ok(html.includes(`working, ${label};`), 'pulse marks the cached count stale');
    assert.doesNotMatch(html, /All clear|class="hero clear"/);
  });
}

test('attention is checking or unavailable even before the first stream snapshot arrives', () => {
  assert.match(render(emptyState()), /class="hero-title">Checking needs you…<\/h2>/);
  assert.match(render({ ...emptyState(), needsYouError: true }), /class="hero-title">Needs you unavailable<\/h2>/);
});

test('only a successful zero clears the title, favicon and sidebar and permits all clear', () => {
  const state = { ...base(), needsYouLoaded: true, needsYouCached: true };
  const attention = attentionPresentation(state);
  assert.equal(attention.status, 'ready');
  assert.equal(attentionTitle(attention, 'Overview'), 'Overview · pi console');
  assert.doesNotMatch(faviconHref(attention), /<circle/);
  const html = render(state);
  assert.match(html, /All clear: nothing needs you/);
  assert.doesNotMatch(html, /nav-badge/);
});

test('a successful positive count retains the existing attention badge and title', () => {
  const state = { ...base(), needsYouLoaded: true, needsYouCached: true, needsYou: [item] };
  const attention = attentionPresentation(state);
  assert.equal(attentionTitle(attention, 'Overview'), '(1) Overview · pi console');
  assert.match(faviconHref(attention), /<circle/);
  assert.match(render(state), /aria-label="1 need you" data-attention="ready">1<\/span>/);
});
