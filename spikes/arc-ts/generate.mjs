import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const absolute = path => fileURLToPath(new URL(path, import.meta.url));
mkdirSync(absolute('./client/generated/'), { recursive: true });
execFileSync(process.execPath, [absolute('./node_modules/@cratis/arc.proxygenerator/dist/cli.js'),
    '--project', absolute('./tsconfig.server.json'),
    '--artifacts', absolute('./server/Features/'),
    '--output', absolute('./client/generated/')], { stdio: 'inherit' });
