// `npm run media`: regenerates every picture in docs/media from the mock daemon's synthetic data, then enforces the budget.
//   node scripts/media/index.mjs [--only <shot id prefix>] [--check]
// Never part of `npm run gate`: it needs Chromium, ffmpeg and cwebp, and pixels depend on the machine's fonts (regenerate on macOS).
// Reads no personal data: the daemon runs the checked-in fixture with a throwaway data directory.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { budget, gifFps, shots } from './scenes.ts';
import { checkBudget, checkReadme, checkReferences, retainedMedia, sizes } from './check.mjs';
import { encodeGif, encodeStill, have } from './encode.mjs';

const root = resolve(import.meta.dirname, '../..');
const mediaDir = join(root, 'docs/media');
const args = process.argv.slice(2);
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined;
const fail = message => { console.error(`media: ${message}`); process.exit(1); };

function preflight() {
  if (!have('ffmpeg')) fail('ffmpeg is required (macOS: brew install ffmpeg; Debian/Ubuntu: apt install ffmpeg)');
  if (!have('cwebp')) fail('cwebp is required (macOS: brew install webp; Debian/Ubuntu: apt install webp)');
  if (!existsSync(join(root, 'packages/web/dist/index.html'))) {
    console.log('building the web bundle first');
    if (spawnSync('npm', ['run', 'build', '-w', '@pi-console/web'], { cwd: root, stdio: 'inherit' }).status !== 0) fail('web build failed');
  }
}

async function capture(work) {
  const { startFrozenRig, captureWeb } = await import('./web.ts');
  const { captureTui } = await import('./tui.ts');
  const { captureHero } = await import('./hero.ts');
  const rig = await startFrozenRig();
  try {
    await captureWeb(rig, work);
    await captureTui(rig, work);
    await captureHero(rig, work);
  } finally { await rig.close(); }
}

function encode(work) {
  mkdirSync(mediaDir, { recursive: true });
  for (const shot of shots.filter(candidate => only === undefined || candidate.id.startsWith(only))) {
    const out = join(mediaDir, shot.file);
    if (shot.kind === 'gif') encodeGif(join(work.dir, shot.id), out, shot.width, gifFps);
    else encodeStill(join(work.dir, `${shot.id}.png`), out, shot.width, shot.kind === 'hero' ? 80 : 84);
    console.log(`  encoded ${shot.file}`);
  }
}

function prune() {
  const known = new Set([...shots.map(shot => shot.file), ...retainedMedia, 'README.md']);
  for (const { name } of sizes(mediaDir)) if (!known.has(name)) rmSync(join(mediaDir, name));
}

function verify() {
  const { files, total, problems } = checkBudget(mediaDir, budget);
  for (const file of files.sort((a, b) => b.bytes - a.bytes)) console.log(`${String(Math.ceil(file.bytes / 1024)).padStart(6)} KB  ${file.name}`);
  console.log(`${String(Math.ceil(total / 1024)).padStart(6)} KB  total (budget ${String(budget.totalKb)} KB)`);
  const readme = checkReadme(root);
  const all = [...problems, ...readme.problems, ...checkReferences(root, shots, mediaDir, readme.text)];
  if (all.length > 0) fail(`\n- ${all.join('\n- ')}`);
}

if (args.includes('--check')) { verify(); process.exit(0); }
preflight();
const work = { dir: join(root, '.ai-work/media-work'), only };
if (only === undefined) rmSync(work.dir, { recursive: true, force: true });
mkdirSync(work.dir, { recursive: true });
await capture(work);
encode(work);
if (only === undefined) { prune(); verify(); }
process.exit(0);
