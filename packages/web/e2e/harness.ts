import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startDaemon } from '@pi-console/testkit';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createStaticServer } from '../src/server/static-server.ts';

/**
 * Playwright's pinned browser build may not be what is cached on this machine; any cached headless shell is good enough
 * for these specs. `PI_CONSOLE_CHROME` overrides; otherwise Playwright's own default applies.
 */
export function browserPath(): string | undefined {
  if (process.env.PI_CONSOLE_CHROME) return process.env.PI_CONSOLE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(cache)) return undefined;
  const shells = readdirSync(cache).filter(name => name.startsWith('chromium_headless_shell-')).sort().reverse();
  const found = shells.map(name => join(cache, name, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')).find(existsSync);
  return found;
}

type Daemon = Awaited<ReturnType<typeof startDaemon>>;
interface Resources { daemon?: Daemon; browser?: Browser; web?: ReturnType<typeof createStaticServer> }

async function cleanup(resources: Resources, dataDirectory: string): Promise<void> {
  try { await resources.browser?.close(); }
  finally {
    await resources.daemon?.close().catch(() => undefined);
    try {
      await new Promise<void>(done => {
        if (!resources.web?.listening) { done(); return; }
        resources.web.close(() => { done(); });
      });
    } finally { rmSync(dataDirectory, { recursive: true, force: true }); }
  }
}

export interface Rig {
  daemon: Daemon;
  baseUrl: string;
  browser: Browser;
  /** Stops the mock daemon; the next startDaemon brings a fresh one up on the same port with the same token, as a restart would. */
  stopDaemon: () => Promise<void>;
  startDaemon: () => Promise<void>;
  open: (route?: string, options?: { token?: string | null; width?: number; height?: number; timezoneId?: string; beforeNavigate?: (page: Page) => void }) => Promise<Page>;
  close: () => Promise<void>;
}

/** Real mock daemon + the built bundle behind the strict-CSP static server + headless Chromium. No external network. */
export async function startRig(options: { speed?: number } = {}): Promise<Rig> {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'pi-console-e2e-'));
  const resources: Resources = {};
  try {
    let daemon = resources.daemon = await startDaemon({ port: 0, speed: options.speed ?? 40, dataDirectory });
    const port = daemon.port;
    const web = resources.web = createStaticServer({ root: resolve(import.meta.dirname, '../dist'), daemon: { host: '127.0.0.1', port } });
    await new Promise<void>((done, reject) => { web.once('error', reject); web.listen(0, '127.0.0.1', done); });
    const baseUrl = `http://127.0.0.1:${String((web.address() as AddressInfo).port)}`;
    const browser = resources.browser = await chromium.launch({ executablePath: browserPath() });
    return {
      get daemon() { return daemon; }, baseUrl, browser,
      stopDaemon: () => daemon.close(),
      async startDaemon() { daemon = resources.daemon = await startDaemon({ port, speed: options.speed ?? 40, dataDirectory }); },
      async open(route = '', opened = {}) {
        const context = await browser.newContext({ viewport: { width: opened.width ?? 1440, height: opened.height ?? 900 }, deviceScaleFactor: 2, timezoneId: opened.timezoneId ?? 'UTC' });
        const page = await context.newPage();
        opened.beforeNavigate?.(page);
        const token = opened.token === undefined ? daemon.token : opened.token;
        const credentials = token ? `${route.includes('?') || !route ? (route ? '&' : '#') : '?'}token=${token}` : '';
        await page.goto(`${baseUrl}/${route ? `#${route}` : ''}${credentials}`);
        return page;
      },
      close: () => cleanup(resources, dataDirectory),
    };
  } catch (error) {
    await cleanup(resources, dataDirectory).catch(() => undefined);
    throw error;
  }
}
