// Checks that make a bad media set fail the run: size budget, README image hygiene, orphans.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const kb = bytes => Math.ceil(bytes / 1024);

export function sizes(mediaDir) {
  return readdirSync(mediaDir).filter(name => statSync(join(mediaDir, name)).isFile()).map(name => ({ name, bytes: statSync(join(mediaDir, name)).size }));
}

export function checkBudget(mediaDir, budget) {
  const files = sizes(mediaDir);
  const problems = [];
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  if (kb(total) > budget.totalKb) problems.push(`total ${String(kb(total))} KB exceeds ${String(budget.totalKb)} KB`);
  for (const file of files) {
    const limit = file.name.startsWith('hero') ? budget.heroKb : budget.fileKb;
    if (kb(file.bytes) > limit) problems.push(`${file.name} is ${String(kb(file.bytes))} KB, over its ${String(limit)} KB limit`);
  }
  return { files, total, problems };
}

const attribute = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/** Every <img> in the README needs meaningful alt, a width and an existing relative path; every Markdown link into docs/ must exist. */
export function checkReadme(root) {
  const text = readFileSync(join(root, 'README.md'), 'utf8');
  const problems = [];
  for (const tag of text.match(/<img\b[^>]*>/g) ?? []) {
    const src = attribute(tag, 'src');
    const alt = attribute(tag, 'alt')?.trim() ?? '';
    if (!src || /^[a-z]+:|^\//.test(src)) problems.push(`img must use a relative src: ${tag}`);
    else if (!existsSync(resolve(root, src))) problems.push(`img source missing: ${src}`);
    if (alt.length < 12) problems.push(`img alt text is empty or too short: ${src ?? tag}`);
    if (!attribute(tag, 'width')) problems.push(`img has no width: ${src ?? tag}`);
  }
  for (const [, target] of text.matchAll(/\]\(((?:docs|packages|scripts)\/[^)#\s]*)/g)) {
    if (!existsSync(resolve(root, target))) problems.push(`link target missing: ${target}`);
  }
  return { text, problems };
}

/** A file in docs/media that no shot produces, or a shot that no document shows, is dead weight. */
export function checkReferences(root, shots, mediaDir, readmeText) {
  const docs = [readmeText, ...readdirSync(join(root, 'docs')).filter(name => name.endsWith('.md')).map(name => readFileSync(join(root, 'docs', name), 'utf8'))].join('\n');
  const problems = [];
  const known = new Set(shots.map(shot => shot.file));
  for (const file of readdirSync(mediaDir)) if (statSync(join(mediaDir, file)).isFile() && file !== 'README.md' && !known.has(file)) problems.push(`orphan file in docs/media: ${file}`);
  for (const shot of shots) if (!docs.includes(shot.file)) problems.push(`${shot.file} is not shown in README.md or docs/*.md`);
  return problems;
}
