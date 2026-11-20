import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
