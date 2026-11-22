import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const tuiUsage = `Usage: pi-console tui [options]

Open the terminal console against a running daemon.

Options:
  --url <url>       Daemon URL (overrides PI_CONSOLE_URL and config.json)
  --data-dir <dir>  Daemon data directory (overrides PI_CONSOLE_DATA_DIR)
  -h, --help        Show this help

Connection settings: PI_CONSOLE_URL, PI_CONSOLE_TOKEN, PI_CONSOLE_TOKEN_FILE,
PI_CONSOLE_DATA_DIR (default ~/.pi-console).
URL fallback: port in <data-dir>/config.json, then http://127.0.0.1:4777.`;

interface TuiCommandIo {
  out: (line: string) => void;
  err: (line: string) => void;
  launch: (env: NodeJS.ProcessEnv) => Promise<number>;
}

/** Parse arguments before launching the interactive console. */
export async function runTuiCommand(args: string[], io: TuiCommandIo = {
  out: line => { console.log(line); },
  err: line => { console.error(line); },
  launch: runTui,
}): Promise<number> {
  let help: boolean;
  let env: NodeJS.ProcessEnv;
  try {
    const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
      help: { type: 'boolean', short: 'h' }, url: { type: 'string' }, 'data-dir': { type: 'string' },
    } });
    help = values.help === true;
    env = { ...process.env, ...(values.url !== undefined ? { PI_CONSOLE_URL: values.url } : {}), ...(values['data-dir'] !== undefined ? { PI_CONSOLE_DATA_DIR: values['data-dir'] } : {}) };
  } catch (error: unknown) {
    io.err(`${error instanceof Error ? error.message : String(error)}\nRun "pi-console tui --help" for usage.`);
    return 2;
  }
  if (help) {
    io.out(tuiUsage);
    return 0;
  }
  return await io.launch(env);
}

const entry = fileURLToPath(import.meta.resolve('@pi-console/tui/main'));

/** The TUI loads OpenTUI's native library through Node's FFI, which needs the flag; a child process keeps the CLI itself flag-free. */
export function tuiCommand(execPath = process.execPath): { command: string; args: string[] } {
  return { command: execPath, args: ['--experimental-ffi', '--disable-warning=ExperimentalWarning', entry] };
}

/** `pi-console tui`: runs the interactive console on the inherited terminal and resolves with its exit code. */
export async function runTui(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const { command, args } = tuiCommand();
  return await new Promise<number>(resolveRun => {
    const child = spawn(command, args, { stdio: 'inherit', env });
    child.on('error', error => { console.error(`pi-console tui could not start: ${error.message}`); resolveRun(1); });
    child.on('exit', (code, signal) => { resolveRun(code ?? (signal ? 1 : 0)); });
  });
}
