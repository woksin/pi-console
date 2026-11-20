#!/usr/bin/env node
import { runDaemon } from './daemon-command.ts';

const usage = 'Usage: pi-console <command>\n\nCommands:\n  daemon   Start the read-only console daemon (pi-console daemon --help)';

/** Entry point: `pi-console daemon [options]`. */
export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== 'daemon') {
    console.error(usage);
    return argv.length === 0 || command === '--help' ? 0 : 2;
  }
  const stopSignal = new Promise<void>(resolve => {
    process.once('SIGINT', () => { resolve(); });
    process.once('SIGTERM', () => { resolve(); });
  });
  return runDaemon(rest, { out: line => { console.log(line); }, stopSignal });
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
