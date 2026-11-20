// Docs checks for the Tier 1 gate: relative links resolve, ADR status headers parse, no unfinished M1 markers.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const skipDirectories = new Set(['node_modules', '.git', 'dist', '.ai-work', '.pi-console-dev']);
const adrStatus = /^- Status: (Proposed|Accepted|Superseded|Deprecated|Rejected)\b/m;
const marker = ['TODO', '(M1)'].join('');

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (skipDirectories.has(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const files = walk(root);
const problems = [];
const rel = path => relative(root, path);

function checkLinks(file) {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const match of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1];
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) continue;
    const path = resolve(dirname(file), decodeURIComponent(target.split('#')[0]));
    if (!existsSync(path)) problems.push(`${rel(file)}: broken link ${target}`);
  }
}

function checkAdr(file) {
  const text = readFileSync(file, 'utf8');
  if (!adrStatus.test(text)) problems.push(`${rel(file)}: ADR needs a "- Status: <Proposed|Accepted|Superseded|Deprecated|Rejected>" line`);
  if (!/^# ADR-\d{4}: /.test(text)) problems.push(`${rel(file)}: ADR title must be "# ADR-NNNN: ..."`);
}

for (const file of files) {
  const path = rel(file);
  if (path.endsWith('.md') && !path.startsWith('spikes/') && !path.includes('node_modules')) checkLinks(file);
  if (/^docs\/adr\/\d{4}-.*\.md$/.test(path)) checkAdr(file);
  if (/\.(md|ts|tsx|mjs|json|yml)$/.test(path) && statSync(file).size < 2_000_000 && readFileSync(file, 'utf8').includes(marker)) {
    problems.push(`${path}: unfinished marker ${marker}`);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`docs ok: ${files.filter(file => file.endsWith('.md')).length} markdown files checked`);
