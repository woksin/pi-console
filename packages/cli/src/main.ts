#!/usr/bin/env node
import { runDaemon } from './daemon-command.ts';
import { runTui } from './tui.ts';

const usage = [
  'Usage: pi-console <command>',
  '',
  'Commands:',
  '  daemon   Start the read-only console daemon (pi-console daemon --help)',
  '  tui      Open the terminal console against a running daemon',
  '',
  'Errors print a short message; set PI_CONSOLE_DEBUG=1 to include a stack trace.',
].join('\n');

function daemonStopSignal(): Promise<void> {
  return new Promise<void>(resolve => {
    process.once('SIGINT', () => { resolve(); });
    process.once('SIGTERM', () => { resolve(); });
  });
}

/** Thin dispatcher; each subcommand lives in its own module. Returns the process exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'daemon') return runDaemon(rest, { out: line => { console.log(line); }, stopSignal: daemonStopSignal() });
  if (command === 'tui') return await runTui();
  if (argv.length === 0 || command === '--help') {
    console.error(usage);
    return 0;
  }
  console.error(`Unknown command "${command}".\n${usage}`);
  return 2;
}

/** Shared process boundary for both the installed executable and direct source entry. */
export async function runCli(argv: readonly string[]): Promise<number> {
  try {
    return await main(argv);
  } catch (error: unknown) {
    console.error(process.env.PI_CONSOLE_DEBUG === '1' ? error : error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) process.exitCode = await runCli(process.argv.slice(2));
