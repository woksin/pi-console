import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { startDaemon } from '@pi-console/testkit';
import { App } from '../app.ts';
import { connect, type Runtime } from '../runtime.ts';
import { h, mountHeadless, type Headless } from '../view/renderer.ts';
import { palette } from '../view/theme.ts';

/** The mock daemon checks the Host header against its port, so it needs a real one, not 0. */
const freePort = async (): Promise<number> => await new Promise((resolvePort, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address() as { port: number }; probe.close(() => { resolvePort(port); }); });
});

export interface Harness {
  daemon: Awaited<ReturnType<typeof startDaemon>>; ui: Headless; runtime: Runtime; quit: { requested: boolean }; stop: () => Promise<void> }

/** The real app against the mock daemon in OpenTUI's in-memory renderer. Specs and the media generator share this. */
export async function startHarness(size = { width: 140, height: 42 }, options: { rate?: number } = {}): Promise<Harness> {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-tui-'));
  const daemon = await startDaemon({ port: await freePort(), dataDirectory: directory, rate: options.rate });
  palette.configure('truecolor', false);
  const runtime = connect({ baseUrl: `http://127.0.0.1:${String(daemon.port)}`, token: daemon.token, tokenSource: 'test' });
  const quit = { requested: false };
  const ui = await mountHeadless(h(App, {
    store: runtime.store, endpoint: `http://127.0.0.1:${String(daemon.port)}`, tokenSource: 'test', animate: false,
    loadTranscript: id => { void runtime.client.transcript(id).then(entries => { runtime.store.mergeTranscript(id, entries); }); },
    loadMemory: id => { void Promise.all([runtime.client.sessionMemory(id), runtime.client.memoryItems(id)]).then(([memory, items]) => { runtime.store.mergeMemory(id, memory, items); }, () => undefined); },
    onQuit: () => { quit.requested = true; },
  }), size);
  const live = () => runtime.store.getSnapshot().needsYou.length > 0 && runtime.store.getSnapshot().connection.connected;
  for (let attempt = 0; attempt < 100 && !live(); attempt++) await new Promise(resolveWait => setTimeout(resolveWait, 50));
  await new Promise(resolveWait => setTimeout(resolveWait, 120));
  await ui.settle();
  return {
    daemon, ui, runtime, quit,
    stop: async () => { runtime.stop(); ui.destroy(); await daemon.close().catch(() => undefined); rmSync(directory, { recursive: true, force: true }); },
  };
}
