import { runTui } from './tui.ts';

const usage = 'Usage: pi-console tui   (daemon and open are wired by their own packages)';

/** Thin dispatcher; each subcommand lives in its own module. Returns the process exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  const [command] = argv;
  if (command === 'tui') return await runTui();
  console.error(command ? `Unknown command "${command}". ${usage}` : usage);
  return 2;
}
