import { createElement } from 'react';
import { DaemonClient } from './api/client.ts';
import { resolveCredentials, type Credentials } from './api/token.ts';
import { throttled } from './refresh.ts';
import { Store } from './store/store.ts';
import { App } from './app.ts';
import { launch } from './view/renderer.ts';
import { MemoryRefreshController, MemoryReviewController, type WindowedCollection } from '@pi-console/viewmodels';
import { detectDepth, palette, themeFromEnv } from './view/theme.ts';

export interface Runtime { store: Store; client: DaemonClient; reviews: MemoryReviewController; loadMemory: (id: string) => Promise<void>; watchMemory: (id: string) => () => void; stop: () => void }

const NEEDS_YOU_REFRESH_MS = 2000;

/** Connects the client to the store: the stream feeds events, "needs you" is refreshed at most every two seconds. */
export function connect(credentials: Credentials): Runtime {
  const store = new Store();
  const client = new DaemonClient(credentials);
  let stopped = false;
  const memory = new MemoryRefreshController(async id => {
    const [summary, items] = await Promise.all([client.sessionMemory(id), client.memoryItems(id)]);
    if (!stopped) store.mergeMemory(id, summary, items);
  }, id => reviews.load(id));
  const loadMemory = (id: string): Promise<void> => memory.refresh(id);
  const reviews = new MemoryReviewController(client, (id, review) => { if (!stopped) store.setMemoryReview(id, review); }, loadMemory);
  const refresher = throttled(async () => { store.setNeedsYou(await client.needsYou()); }, NEEDS_YOU_REFRESH_MS);
  const refresh = refresher.request;
  void client.stream({
    onEvent: event => {
      store.apply(event);
      if (event.type === 'snapshot') memory.invalidateVisible();
      if (event.type === 'session.updated' && event.payload.memoryChanged) memory.invalidate(event.payload.id);
      if (event.type !== 'transcript.appended') refresh();
    },
    onState: state => { store.setConnection(state.connected, state.error); if (state.connected) refresh(); },
  });
  return { store, client, reviews, loadMemory, watchMemory: id => memory.watch(id), stop: () => { stopped = true; memory.dispose(); reviews.dispose(); refresher.stop(); client.stop(); store.dispose(); } };
}

const paging = new Set<WindowedCollection>();

/** Fetches the next older page of a windowed list once at a time; a no-op when the list is complete. */
async function loadMore(runtime: Runtime, collection: WindowedCollection): Promise<void> {
  const data = runtime.store.getSnapshot();
  const progress = data.history[collection];
  if (!data.bounded.includes(collection) || progress?.more === false || paging.has(collection)) return;
  paging.add(collection);
  try { runtime.store.mergePage(collection, await runtime.client.page(collection, progress?.cursor ?? null)); } catch { /* retried on the next scroll to the end */ } finally { paging.delete(collection); }
}

export interface RunOptions { env?: NodeJS.ProcessEnv }

/** Starts the interactive TUI on the real terminal; resolves when the user quits. Exit code 0 on a clean quit. */
export async function run(options: RunOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  const credentials = resolveCredentials(env);
  palette.configure(detectDepth(env), themeFromEnv(env));
  const runtime = connect(credentials);
  const animate = env.PI_CONSOLE_REDUCED_MOTION !== '1' && env.NO_MOTION === undefined;
  const fixed = Date.parse(env.PI_CONSOLE_NOW ?? '');
  const clock = Number.isNaN(fixed) ? undefined : () => fixed;
  return await new Promise<number>(resolveRun => {
    let handle: Awaited<ReturnType<typeof launch>> | undefined;
    const finish = () => { runtime.stop(); resolveRun(0); };
    const node = createElement(App, {
      store: runtime.store, endpoint: credentials.baseUrl, tokenSource: credentials.tokenSource, animate, clock,
      loadMore: collection => { void loadMore(runtime, collection); },
      loadTranscript: id => { void runtime.client.session(id).then(detail => { runtime.store.mergeDetail(detail); }, () => undefined); void runtime.client.transcript(id).then(entries => { runtime.store.mergeTranscript(id, entries); }, () => { runtime.store.mergeTranscript(id, []); }); },
      loadMemory: id => { void runtime.loadMemory(id); }, watchMemory: runtime.watchMemory,
      requestMemoryAction: (id, itemId, action) => { void runtime.reviews.request(id, itemId, action); },
      onQuit: () => { handle?.destroy(); finish(); },
    });
    void launch(node, { fps: animate ? 20 : 8, onDestroy: finish }).then(started => { handle = started; });
  });
}
