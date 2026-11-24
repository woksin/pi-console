// `npm run console`: the gallery's loopback-only mock daemon, serving isolated sample data.
// Keep this entry JavaScript-only until the shared Node preflight has passed.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import timers from 'node:timers';
import { nodeVersionError } from '../packages/cli/bin/node-version.mjs';

export const root = resolve(import.meta.dirname, '..');

function preflight() {
  const error = nodeVersionError(process.versions.node);
  if (error) throw new Error(error);
}

export function startTicker(publish, tick, interval) {
  let pending = Promise.resolve();
  const timer = timers.setInterval(() => {
    pending = pending.then(async () => {
      const events = tick();
      if (events.length === 0) timers.clearInterval(timer);
      else await publish(events);
    }).catch(error => {
      timers.clearInterval(timer);
      console.error(`Demo live updates stopped: ${error.message}`);
    });
  }, interval);
  timer.unref();
  return async () => { timers.clearInterval(timer); await pending; };
}

async function startWeb(webDist, daemon) {
  if (!webDist) return undefined;
  const { createStaticServer } = await import('../packages/web/src/server/static-server.ts');
  const server = createStaticServer({ root: webDist, daemon: { host: '127.0.0.1', port: daemon.port } });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  return server;
}

async function cleanup(daemon, web, directory) {
  try { await daemon?.close(); }
  finally {
    if (web) {
      web.closeAllConnections();
      await new Promise(done => { web.close(done); });
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Used by the interactive launcher and the VHS recorder. Never enables filesystem ingestion. */
export async function startDemo(webDist) {
  preflight();
  const { startDaemon } = await import('../packages/testkit/src/mock-daemon/server.ts');
  const { demoData, demoTickMs } = await import('./demo-data.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-demo-'));
  let daemon;
  let web;
  let stopTicker;
  try {
    const { fixture, memory, memoryHandoffAt, tick } = demoData();
    daemon = await startDaemon({ port: 0, speed: 0, dataDirectory: directory });
    // The media rig serves the fixture directly, including explicit names, lanes and repository identities.
    Object.assign(daemon.store.fixture, fixture);
    daemon.store.memory = memory;
    daemon.store.memoryHandoffAt = memoryHandoffAt;
    web = await startWeb(webDist, daemon);
    stopTicker = startTicker(events => {
      events.forEach(({ type, payload }) => daemon.store.publish(type, payload));
    }, tick, demoTickMs);
    return {
      port: web?.address().port ?? daemon.port, address: daemon.address, directory, tokenFile: join(directory, 'token'),
      async close() {
        await stopTicker();
        await cleanup(daemon, web, directory);
      },
    };
  } catch (error) {
    await stopTicker?.();
    await cleanup(daemon, web, directory);
    throw error;
  }
}

export function launchUrl(demo) {
  const token = readFileSync(demo.tokenFile, 'utf8').trim();
  return `http://127.0.0.1:${demo.port}/#token=${encodeURIComponent(token)}`;
}

export function openBrowser(url, platform = process.platform, run = spawnSync) {
  const command = { darwin: 'open', linux: 'xdg-open' }[platform];
  if (!command) return;
  // Browser launch is optional: a missing opener must not stop the daemon.
  try { run(command, [url], { stdio: 'ignore', timeout: 5000 }); } catch { /* Best effort only. */ }
}

async function runTui(demo, stopped) {
  const child = spawn(process.execPath, ['--experimental-ffi', join(root, 'packages/tui/src/main.ts')], {
    cwd: root, stdio: 'inherit', env: {
      ...process.env, PI_CONSOLE_URL: `http://127.0.0.1:${demo.port}`, PI_CONSOLE_TOKEN: readFileSync(demo.tokenFile, 'utf8').trim(),
    },
  });
  const exited = once(child, 'exit');
  try {
    const result = await Promise.race([exited, stopped]);
    if (Array.isArray(result) && result[0]) process.exitCode = result[0];
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await exited;
    }
  }
}

function buildWeb() {
  const build = spawnSync('npm', ['run', 'build', '-w', '@pi-console/web'], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) throw new Error('Demo web build failed');
}

async function main() {
  preflight();
  let stop;
  const stopped = new Promise(done => { stop = done; });
  // npm and the terminal can both deliver the same signal; keep handlers until cleanup finishes.
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  let demo;
  try {
    const tui = process.argv.includes('--tui');
    if (!tui) buildWeb();
    demo = await startDemo(tui ? undefined : join(root, 'packages/web/dist'));
    if (!tui) {
      const url = launchUrl(demo);
      console.log(`\nSynthetic demo (no live agents or user files).\nWeb: ${url}\n` +
        `Terminal demo: npm run console -- --tui\n` +
        `Live samples run for 15 minutes. Ctrl-C stops the daemon and removes its temporary data and token.\n` +
        `--open passes this throwaway loopback token to your browser opener; it may appear in local process arguments.`);
      if (process.argv.includes('--open')) openBrowser(url);
    }
    if (tui) await runTui(demo, stopped);
    else await stopped;
  } finally {
    await demo?.close();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
