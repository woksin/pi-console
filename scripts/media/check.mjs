// Checks that make a bad media set fail the run: size budget, README image hygiene, orphans.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const kb = bytes => Math.ceil(bytes / 1024);

// Historical acceptance evidence still linked by docs/m1-acceptance.md, not a showcase output.
export const retainedMedia = ['tui/tour-colour.cast'];

export function sizes(mediaDir, prefix = '') {
  return readdirSync(join(mediaDir, prefix)).flatMap(entry => {
    const name = join(prefix, entry);
    const stat = statSync(join(mediaDir, name));
    return stat.isDirectory() ? sizes(mediaDir, name) : [{ name, bytes: stat.size }];
  });
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

function checkImage(root, tag) {
  const problems = [];
  const src = attribute(tag, 'src');
  const alt = attribute(tag, 'alt')?.trim() ?? '';
  if (!src || /^[a-z]+:|^\//.test(src)) problems.push(`img must use a relative src: ${tag}`);
  else if (!existsSync(resolve(root, src))) problems.push(`img source missing: ${src}`);
  if (alt.length < 12) problems.push(`img alt text is empty or too short: ${src ?? tag}`);
  if (!attribute(tag, 'width')) problems.push(`img has no width: ${src ?? tag}`);
  return problems;
}

/** Every image needs meaningful alt, width and a relative path; local links and picture sources must exist. */
export function checkReadme(root) {
  const text = readFileSync(join(root, 'README.md'), 'utf8');
  const problems = (text.match(/<img\b[^>]*>/g) ?? []).flatMap(tag => checkImage(root, tag));
  const targets = [
    ...Array.from(text.matchAll(/\]\(([^)\s]+)/g), match => match[1]),
    ...Array.from(text.matchAll(/<source\b[^>]*srcset="([^"]+)"/g), match => match[1]),
  ];
  for (const target of targets) {
    if (/^[a-z]+:|^#/.test(target)) continue;
    if (!existsSync(resolve(root, target.split('#')[0]))) problems.push(`link target missing: ${target}`);
  }
  return { text, problems };
}

/** A file in docs/media that no shot produces, or a shot that no document shows, is dead weight. */
export function checkReferences(root, shots, mediaDir, readmeText) {
  const docs = [readmeText, ...readdirSync(join(root, 'docs')).filter(name => name.endsWith('.md')).map(name => readFileSync(join(root, 'docs', name), 'utf8'))].join('\n');
  const problems = [];
  const known = new Set([...shots.map(shot => shot.file), ...retainedMedia, 'README.md']);
  for (const { name } of sizes(mediaDir)) if (!known.has(name)) problems.push(`orphan file in docs/media: ${name}`);
  for (const shot of shots) if (!docs.includes(shot.file)) problems.push(`${shot.file} is not shown in README.md or docs/*.md`);
  return problems;
}
