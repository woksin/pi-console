import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { apiOnlyHint, defaultDataDir, isUsableWebBundle, loadConfig, loadToken, sourceIds, startDaemon, type ConfigOverrides, type RunningDaemon, type SourceId } from '@pi-console/daemon';

const usage = (): string => `Usage: pi-console daemon [options]

Starts the read-only console daemon on 127.0.0.1 (never another interface).

Options:
  --data-dir <dir>      Data directory with token, console.db and config.json (flag > PI_CONSOLE_DATA_DIR > ~/.pi-console)
  --port <n>            Port, 0 for any free port (default 4777)
  --web-dist <dir>      Built web bundle to serve at / (default: API only)
  --agent-root <dir>    pi agent directory every agent-side source derives from (default ~/.pi/agent)
  --orch-root <dir>     orch directory with heartbeats and the message inbox (default ~/.pi/orch)
  --lanes-root <dir>    Lanes root with lanes.json and .state/roster (default $LANES_DIR; none when unset)
  --lane-status-dir <dir>  Directory with <LANE>.status files (default $LANE_STATUS_DIR, then $INBOX_DIR/status, then <agent-root>/lane-status)
  --sessions <dir>      pi session directory; repeat for more (default <agent-root>/sessions)
  --no-source <id>      Turn one source off; repeat for more. Ids: ${sourceIds.join(', ')}
  --source-poll-ms <n>  Poll interval of the non-session sources, 250-60000 (default 2000)
  --backfill-days <n>   Days of session history read on first start (default 14)
  -h, --help            Show this help

Memory review is off by default; set "memoryActions": true in <data-dir>/config.json and restart to enable it.

The token is in <data-dir>/token (owner-only). With --web-dist the daemon prints this launch link; open it once: http://127.0.0.1:<port>/#token=<token>.`;

export const daemonUsage = usage();

export interface DaemonCommandIo {
  out: (line: string) => void;
  /** Resolves when the process should stop (SIGINT/SIGTERM in production). */
  stopSignal: Promise<void>;
  /** Environment the data and lane directories fall back to (default `process.env`). */
  env?: NodeJS.ProcessEnv;
}

const integer = (flag: string, text: string): number => {
  if (!/^\d+$/.test(text)) throw new Error(`--${flag} must be a non-negative integer`);
  return Number(text);
};

const sourceOf = (id: string): SourceId => {
  if (!(sourceIds as readonly string[]).includes(id)) throw new Error(`--no-source: unknown source "${id}"; valid ids: ${sourceIds.join(', ')}`);
  return id as SourceId;
};

/** The lane directories a flag did not name, from the same variables the lane tools use. Read here only, never in the daemon. */
function laneEnvironment(env: NodeJS.ProcessEnv): { lanesRoot?: string; laneStatusDir?: string } {
  const set = (value: string | undefined): string | undefined => (value === undefined || value === '' ? undefined : resolve(value));
  return { lanesRoot: set(env.LANES_DIR), laneStatusDir: set(env.LANE_STATUS_DIR) ?? (env.INBOX_DIR ? join(resolve(env.INBOX_DIR), 'status') : undefined) };
}

export function parseDaemonArgs(args: string[], env: NodeJS.ProcessEnv = process.env): { help: boolean; dataDir: string; overrides: ConfigOverrides } {
  const { values } = parseArgs({
    args, strict: true, allowPositionals: false,
    options: {
      'data-dir': { type: 'string' }, port: { type: 'string' }, 'web-dist': { type: 'string' },
      sessions: { type: 'string', multiple: true }, 'agent-root': { type: 'string' }, 'orch-root': { type: 'string' }, 'lanes-root': { type: 'string' }, 'lane-status-dir': { type: 'string' },
      'no-source': { type: 'string', multiple: true }, 'source-poll-ms': { type: 'string' }, 'backfill-days': { type: 'string' }, help: { type: 'boolean', short: 'h' },
    },
  });
  const given = <T>(flag: keyof typeof values, read: (text: never) => T): T | undefined => (values[flag] === undefined ? undefined : read(values[flag] as never));
  const fallback = laneEnvironment(env);
  const candidates: Record<string, unknown> = {
    port: given('port', (text: string) => integer('port', text)),
    webDist: given('web-dist', (text: string) => resolve(text)),
    sessionRoots: given('sessions', (paths: string[]) => paths.map(path => resolve(path))),
    agentRoot: given('agent-root', (text: string) => resolve(text)),
    orchRoot: given('orch-root', (text: string) => resolve(text)),
    lanesRoot: given('lanes-root', (text: string) => resolve(text)) ?? fallback.lanesRoot,
    laneStatusDir: given('lane-status-dir', (text: string) => resolve(text)) ?? fallback.laneStatusDir,
    sources: given('no-source', (ids: string[]) => Object.fromEntries(ids.map(id => [sourceOf(id), false]))),
    sourcePollMs: given('source-poll-ms', (text: string) => integer('source-poll-ms', text)),
    backfillWindowDays: given('backfill-days', (text: string) => integer('backfill-days', text)),
  };
  const overrides = Object.fromEntries(Object.entries(candidates).filter(([, value]) => value !== undefined)) as ConfigOverrides;
  return { help: values.help === true, dataDir: resolve(values['data-dir'] ?? env.PI_CONSOLE_DATA_DIR ?? defaultDataDir()), overrides };
}

/** Runs the daemon until `stopSignal` resolves. The token appears only in the launch link on stdout, and only when a web bundle is served. */
export async function runDaemon(args: string[], io: DaemonCommandIo): Promise<number> {
  const parsed = parseDaemonArgs(args, io.env);
  if (parsed.help) {
    io.out(daemonUsage);
    return 0;
  }
  const config = loadConfig(parsed.dataDir, parsed.overrides);
  const daemon: RunningDaemon = await startDaemon(config);
  io.out(`pi-console daemon listening on http://127.0.0.1:${daemon.port} (ready in ${Math.round(daemon.startupMs)} ms)`);
  io.out(`token file: ${parsed.dataDir}/token`);
  io.out((await isUsableWebBundle(config.webDist)) ? `open the web console: http://127.0.0.1:${daemon.port}/#token=${loadToken(parsed.dataDir)}` : apiOnlyHint);
  await io.stopSignal;
  await daemon.close();
  return 0;
}
