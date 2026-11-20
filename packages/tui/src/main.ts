// Entry point: node --experimental-ffi packages/tui/src/main.ts
import { CredentialError } from './api/token.ts';
import { run } from './runtime.ts';

run().then(code => { process.exit(code); }, (error: unknown) => {
  console.error(error instanceof CredentialError ? error.message : `pi-console TUI failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(error instanceof CredentialError ? 2 : 1);
});
