import { createElement } from 'react';
import { DaemonClient } from './api/client.ts';
import { resolveCredentials, type Credentials } from './api/token.ts';
import { throttled } from './refresh.ts';
import { Store } from './store/store.ts';
import { App } from './app.ts';
import { launch } from './view/renderer.ts';
import { detectDepth, palette } from './view/theme.ts';

export interface Runtime { store: Store; client: DaemonClient; stop: () => void }

const NEEDS_YOU_REFRESH_MS = 2000;

/** Connects the client to the store: the stream feeds events, "needs you" is refreshed at most every two seconds. */
export function connect(credentials: Credentials): Runtime {
  const store = new Store();
  const client = new DaemonClient(credentials);
  const refresher = throttled(async () => { store.setNeedsYou(await client.needsYou()); }, NEEDS_YOU_REFRESH_MS);
  const refresh = refresher.request;
  void client.stream({
    onEvent: event => { store.apply(event); if (event.type !== 'transcript.appended') refresh(); },
    onState: state => { store.setConnection(state.connected, state.error); if (state.connected) refresh(); },
  });
  return { store, client, stop: () => { refresher.stop(); client.stop(); store.dispose(); } };
}

export interface RunOptions { env?: NodeJS.ProcessEnv }

/** Starts the interactive TUI on the real terminal; resolves when the user quits. Exit code 0 on a clean quit. */
export async function run(options: RunOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  const credentials = resolveCredentials(env);
  palette.configure(detectDepth(env), env.PI_CONSOLE_HIGH_CONTRAST === '1');
  const runtime = connect(credentials);
  const animate = env.PI_CONSOLE_REDUCED_MOTION !== '1' && env.NO_MOTION === undefined;
  const fixed = Date.parse(env.PI_CONSOLE_NOW ?? '');
  const clock = Number.isNaN(fixed) ? undefined : () => fixed;
  return await new Promise<number>(resolveRun => {
    let handle: Awaited<ReturnType<typeof launch>> | undefined;
    const finish = () => { runtime.stop(); resolveRun(0); };
    const node = createElement(App, {
      store: runtime.store, endpoint: credentials.baseUrl, tokenSource: credentials.tokenSource, animate, clock,
      loadTranscript: id => { void runtime.client.transcript(id).then(entries => { runtime.store.mergeTranscript(id, entries); }, () => { runtime.store.mergeTranscript(id, []); }); },
      onQuit: () => { handle?.destroy(); finish(); },
    });
    void launch(node, { fps: animate ? 20 : 8, onDestroy: finish }).then(started => { handle = started; });
  });
}
