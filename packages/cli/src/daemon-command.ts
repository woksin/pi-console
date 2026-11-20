import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { defaultDataDir, loadConfig, startDaemon, type DaemonConfig, type RunningDaemon } from '@pi-console/daemon';

export const daemonUsage = `Usage: pi-console daemon [options]

Starts the read-only console daemon on 127.0.0.1 (never another interface).

Options:
  --data-dir <dir>      Data directory with token, console.db and config.json (default ~/.pi-console)
  --port <n>            Port, 0 for any free port (default 4777)
  --web-dist <dir>      Built web bundle to serve at / (default: API only)
  --sessions <dir>      pi session directory; repeat for more (default ~/.pi/agent/sessions)
  --backfill-days <n>   Days of session history read on first start (default 14)
  -h, --help            Show this help

The token is in <data-dir>/token (owner-only). Open the web UI once with http://127.0.0.1:<port>/?token=<token>.`;

export interface DaemonCommandIo {
  out: (line: string) => void;
  /** Resolves when the process should stop (SIGINT/SIGTERM in production). */
  stopSignal: Promise<void>;
}

const integer = (flag: string, text: string): number => {
  if (!/^\d+$/.test(text)) throw new Error(`--${flag} must be a non-negative integer`);
  return Number(text);
};

/** Flags to config overrides; only flags that were given override config.json. */
export function parseDaemonArgs(args: string[]): { help: boolean; dataDir: string; overrides: Partial<DaemonConfig> } {
  const { values } = parseArgs({
    args, strict: true, allowPositionals: false,
    options: {
      'data-dir': { type: 'string' }, port: { type: 'string' }, 'web-dist': { type: 'string' },
      sessions: { type: 'string', multiple: true }, 'backfill-days': { type: 'string' }, help: { type: 'boolean', short: 'h' },
    },
  });
  const overrides: Partial<DaemonConfig> = {};
  if (values.port !== undefined) overrides.port = integer('port', values.port);
  if (values['web-dist'] !== undefined) overrides.webDist = resolve(values['web-dist']);
  if (values.sessions !== undefined) overrides.sessionRoots = values.sessions.map(path => resolve(path));
  if (values['backfill-days'] !== undefined) overrides.backfillWindowDays = integer('backfill-days', values['backfill-days']);
  return { help: values.help === true, dataDir: resolve(values['data-dir'] ?? defaultDataDir()), overrides };
}

/** Runs the daemon until `stopSignal` resolves. Never prints the token. */
export async function runDaemon(args: string[], io: DaemonCommandIo): Promise<number> {
  const parsed = parseDaemonArgs(args);
  if (parsed.help) {
    io.out(daemonUsage);
    return 0;
  }
  const config = loadConfig(parsed.dataDir, parsed.overrides);
  const daemon: RunningDaemon = await startDaemon(config);
  io.out(`pi-console daemon listening on http://127.0.0.1:${daemon.port} (ready in ${Math.round(daemon.startupMs)} ms)`);
  io.out(`token file: ${parsed.dataDir}/token`);
  await io.stopSignal;
  await daemon.close();
  return 0;
}
