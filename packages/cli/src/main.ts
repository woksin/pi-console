#!/usr/bin/env node
import { runDaemon } from './daemon-command.ts';
import { runTui } from './tui.ts';

const usage = [
  'Usage: pi-console <command>',
  '',
  'Commands:',
  '  daemon   Start the read-only console daemon (pi-console daemon --help)',
  '  tui      Open the terminal console against a running daemon',
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

if (import.meta.main) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
