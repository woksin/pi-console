import { createElement } from 'react';
import { TranscriptLoader } from './transcript-loader.ts';
import { MemoryLoader } from './memory-loader.ts';
import { DaemonClient } from './api/client.ts';
import { resolveCredentials, type Credentials } from './api/token.ts';
import { pollWhileConnected, throttled, type ConnectedRefresher, type Refresher } from './refresh.ts';
import { graphRefresher } from './graph-refresh.ts';
import { Store } from './store/store.ts';
import { App } from './app.ts';
import { launch } from './view/renderer.ts';
import { MemoryRefreshController, MemoryReviewController, type WindowedCollection } from '@pi-console/viewmodels';
import { detectDepth, palette, themeFromEnv } from './view/theme.ts';

export interface Runtime { store: Store; client: DaemonClient; loadTranscript: TranscriptLoader['load']; pageTranscript: TranscriptLoader['page']; focusTranscript: TranscriptLoader['focus']; reviews: Pick<MemoryReviewController, 'load' | 'request'>; loadMemory: (id: string) => Promise<void>; loadMoreMemory: MemoryLoader['more']; retryNeedsYou: Refresher['request']; retryGraph: Refresher['request']; watchMemory: (id: string) => () => void; stop: () => void }

const NEEDS_YOU_REFRESH_MS = 2000;
const NEEDS_YOU_POLL_MS = 60_000;

/** Connects the client to the store: the stream feeds events, "needs you" is refreshed at most every two seconds. */
export function connect(credentials: Credentials): Runtime {
  const store = new Store();
  const client = new DaemonClient(credentials);
  let stopped = false;
  // Loaders and the review controller cache per-daemon state; a reset replaces them (the old ones stop publishing) rather than patching each cache.
  let memoryLoader = new MemoryLoader(store, client);
  const memory = new MemoryRefreshController(id => memoryLoader.refresh(id), id => reviews.load(id, { fresh: true }));
  const loadMemory = (id: string): Promise<void> => memory.refresh(id);
  const loadMoreMemory = olderMemory(store, () => memoryLoader, memory);
  const newReviews = (): MemoryReviewController => new MemoryReviewController(client, (id, review) => { if (!stopped) store.setMemoryReview(id, review); }, loadMemory);
  let current = newReviews();
  const reviews: Runtime['reviews'] = { load: (id, options) => current.load(id, options), request: (id, itemId, action) => current.request(id, itemId, action) };
  const transcripts = new TranscriptLoader(store, client);
  const refresher = attentionRequests(store, client);
  const graph = graphRefresher(client, value => { store.setGraph(value); }, () => { store.markGraphFailed(); });
  const refresh = refresher.request;
  void client.stream({
    onEvent: event => {
      store.apply(event);
      if (event.type === 'snapshot') { transcripts.resume(); memory.invalidateVisible(); }
      if (event.type === 'session.updated' && event.payload.memoryChanged) memory.invalidate(event.payload.id);
      if (event.type !== 'transcript.appended') refresh();
      graph.request(event.type);
    },
    onReset: () => {
      store.reset();
      transcripts.reset();
      memoryLoader.stop();
      memoryLoader = new MemoryLoader(store, client);
      current.dispose();
      current = newReviews();
    },
    onState: state => { store.setConnection(state.connected, state.error); refresher.setConnected(state.connected); if (state.connected) graph.request(); },
  });
  return { store, client, loadTranscript: transcripts.load, pageTranscript: transcripts.page, focusTranscript: transcripts.focus, reviews, loadMemory, loadMoreMemory, retryNeedsYou: refresh, retryGraph: () => { graph.request(); }, watchMemory: id => memory.watch(id), stop: () => { stopped = true; transcripts.stop(); memoryLoader.stop(); memory.dispose(); current.dispose(); refresher.stop(); graph.stop(); client.stop(); store.dispose(); } };
}

function olderMemory(store: Store, loader: () => MemoryLoader, refresh: MemoryRefreshController): Runtime['loadMoreMemory'] {
  return id => {
    if (store.getSnapshot().memoryHistory.get(id)?.error === 'refresh') {
      refresh.invalidate(id);
      return refresh.refresh(id);
    }
    return loader().more(id);
  };
}

function attentionRequests(store: Store, client: DaemonClient): ConnectedRefresher {
  let stopped = false;
  const loadHealth = async () => {
    try {
      const health = await client.health();
      if (!stopped) store.setHealth(health);
    } catch { /* Settings keeps the last health record; the connection banner reports an unreachable daemon. */ }
  };
  const load = async () => {
    void loadHealth();
    store.setNeedsYouError(false);
    try {
      const items = await client.needsYou();
      if (!stopped) store.setNeedsYou(items);
    } catch { if (!stopped) store.setNeedsYouError(true); }
  };
  const refresher = throttled(load, NEEDS_YOU_REFRESH_MS);
  return pollWhileConnected({ request: refresher.request, stop: () => { stopped = true; refresher.stop(); } }, NEEDS_YOU_POLL_MS);
}

const paging = new Set<WindowedCollection>();

/** Fetches the next older page of a windowed list once at a time; a no-op when the list is complete. */
async function loadMore(runtime: Runtime, collection: WindowedCollection): Promise<void> {
  const data = runtime.store.getSnapshot();
  const progress = data.history[collection];
  if (!data.bounded.includes(collection) || progress?.more === false || paging.has(collection)) return;
  paging.add(collection);
  runtime.store.setHistoryError(collection, false);
  try { runtime.store.mergePage(collection, await runtime.client.page(collection, progress?.cursor ?? null)); } catch { runtime.store.setHistoryError(collection, true); } finally { paging.delete(collection); }
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
  return await new Promise<number>((resolveRun, rejectRun) => {
    let handle: Awaited<ReturnType<typeof launch>> | undefined;
    const finish = () => { runtime.stop(); resolveRun(0); };
    const node = createElement(App, {
      store: runtime.store, endpoint: credentials.baseUrl, tokenSource: credentials.tokenSource, animate, clock,
      retryNeedsYou: runtime.retryNeedsYou,
      retryGraph: runtime.retryGraph,
      loadMore: collection => { void loadMore(runtime, collection); },
      loadTranscript: runtime.loadTranscript, pageTranscript: runtime.pageTranscript, focusTranscript: runtime.focusTranscript,
      loadMemory: id => { void runtime.loadMemory(id); }, watchMemory: runtime.watchMemory,
      loadMoreMemory: id => { void runtime.loadMoreMemory(id); },
      requestMemoryAction: (id, itemId, action) => { void runtime.reviews.request(id, itemId, action); },
      onQuit: () => { handle?.destroy(); finish(); },
    });
    void launch(node, { fps: animate ? 20 : 8, onDestroy: finish }).then(started => { handle = started; }, (error: unknown) => { runtime.stop(); rejectRun(error instanceof Error ? error : new Error(String(error))); });
  });
}
