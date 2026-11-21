// VHS-only entry: no credential appears in the tape or its visible shell command.
import { readFileSync } from 'node:fs';
process.env.PI_CONSOLE_TOKEN = readFileSync(process.env.PI_CONSOLE_DEMO_TOKEN_FILE, 'utf8').trim();
await import('../../packages/tui/src/main.ts');
