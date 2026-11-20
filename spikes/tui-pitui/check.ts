import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';

const start = performance.now();
for (const file of readdirSync(import.meta.dirname).filter(file => /\.(ts|json)$/.test(file))) {
  const text = readFileSync(new URL(file, import.meta.url), 'utf8');
  if (!text.endsWith('\n') || /[\t ]+$/m.test(text) || text.includes('\r')) throw new Error(`Whitespace: ${file}`);
  if (file.endsWith('.json')) JSON.parse(text);
  if (file.endsWith('.ts')) {
    const input = stripTypeScriptTypes(text, { mode: 'strip' });
    const result = spawnSync(process.execPath, ['--check', '--input-type=module'], { input, stdio: ['pipe', 'inherit', 'inherit'] });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
console.log(`PASS: pi-tui build/syntax + JSON + whitespace (${Math.round(performance.now() - start)} ms); Node runs TypeScript directly.`);
