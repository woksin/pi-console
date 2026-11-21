// `npm run demo`: a real, loopback-only daemon with an isolated synthetic event log.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SqliteEventLog } from '../packages/core/src/event-log/sqlite-event-log.ts';
import { defaultConfig } from '../packages/daemon/src/config.ts';
import { startDaemon } from '../packages/daemon/src/daemon.ts';
import { demoData } from './demo-data.mjs';

export const root = resolve(import.meta.dirname, '..');

/** Used by the interactive launcher and the VHS recorder. Never enables filesystem ingestion. */
export async function startDemo(webDist) {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-demo-'));
  let daemon;
  try {
    const { events, transcripts } = demoData();
    const log = new SqliteEventLog(join(directory, 'console.db'));
    try { await log.append(events); } finally { log.close(); }
    daemon = await startDaemon({
      ...defaultConfig(directory), port: 0, ingest: false, sessionRoots: [],
      agentRoot: join(directory, 'no-agent'), orchRoot: join(directory, 'no-orch'),
      lanesRoot: join(directory, 'no-lanes'), laneStatusDir: join(directory, 'no-status'),
      memoryRoot: join(directory, 'no-memory'), webDist, transcripts,
    });
    return {
      port: daemon.port, directory, tokenFile: join(directory, 'token'),
      async close() {
        await daemon.close();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await daemon?.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  let stop;
  const stopped = new Promise(done => { stop = done; });
  // npm and the terminal can both deliver the same signal; keep handlers until cleanup finishes.
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  let demo;
  try {
    const build = spawnSync('npm', ['run', 'build', '-w', '@pi-console/web'], { cwd: root, stdio: 'inherit' });
    if (build.status !== 0) throw new Error('Demo web build failed');
    demo = await startDemo(join(root, 'packages/web/dist'));
    console.log(`\nSynthetic demo (no live agents or user files).\nWeb: http://127.0.0.1:${demo.port}\n` +
      `Authenticate by pasting the contents of ${demo.tokenFile} into the web connection screen.\n` +
      `In another terminal, from this checkout:\n` +
      `PI_CONSOLE_URL=http://127.0.0.1:${demo.port} PI_CONSOLE_TOKEN="$(cat '${demo.tokenFile}')" npm run start -w @pi-console/tui\n` +
      `Ctrl-C stops the daemon and removes its temporary data and token.`);
    await stopped;
  } finally {
    await demo?.close();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
