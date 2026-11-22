// `npm run media`: regenerates the synthetic gallery, including a VHS tour against the real demo daemon.
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
const onlyVhs = only !== undefined && 'tui-vhs'.startsWith(only) && !'tui-tour'.startsWith(only);
const fail = message => { console.error(`media: ${message}`); process.exit(1); };
const hasVhs = spawnSync('vhs', ['--version'], { stdio: 'ignore' }).status === 0 && spawnSync('ttyd', ['--version'], { stdio: 'ignore' }).status === 0;

function preflight() {
  if (!have('ffmpeg')) fail('ffmpeg is required (macOS: brew install ffmpeg; Debian/Ubuntu: apt install ffmpeg)');
  if (!have('cwebp')) fail('cwebp is required (macOS: brew install webp; Debian/Ubuntu: apt install webp)');
  if (only === undefined || 'tui-vhs'.startsWith(only)) {
    console.log(hasVhs ? 'tui-vhs: recording with VHS against the real demo daemon' : 'tui-vhs: VHS/ttyd unavailable; falling back to the existing PTY frame capture (mock daemon)');
  }
  if (!existsSync(join(root, 'packages/web/dist/index.html'))) {
    console.log('building the web bundle first');
    if (spawnSync('npm', ['run', 'build', '-w', '@pi-console/web'], { cwd: root, stdio: 'inherit' }).status !== 0) fail('web build failed');
  }
}

async function capture(work) {
  if (onlyVhs && hasVhs) return;
  const { startFrozenRig, captureWeb } = await import('./web.ts');
  const { captureTui } = await import('./tui.ts');
  const { captureHero } = await import('./hero.ts');
  const rig = await startFrozenRig();
  try {
    await captureWeb(rig, work);
    await captureTui(rig, onlyVhs ? { ...work, only: 'tui-tour' } : work);
    await captureHero(rig, work);
  } finally { await rig.close(); }
}

function encode(work) {
  mkdirSync(mediaDir, { recursive: true });
  for (const shot of shots.filter(candidate => only === undefined || candidate.id.startsWith(only))) {
    const out = join(mediaDir, shot.file);
    if (shot.id === 'tui-vhs' && hasVhs) {
      const recorded = spawnSync(process.execPath, ['scripts/media/vhs.mjs'], { cwd: root, stdio: 'inherit', env: { ...process.env, MEDIA_OUT: mediaDir } });
      if (recorded.status !== 0) fail('VHS capture failed');
    } else if (shot.kind === 'gif') encodeGif(join(work.dir, shot.id === 'tui-vhs' ? 'tui-tour' : shot.id), out, shot.width, gifFps);
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
rmSync(work.dir, { recursive: true, force: true });
mkdirSync(work.dir, { recursive: true });
// Exit is synchronous even on encoder/preflight failures: never retain the large intermediate frames.
process.once('exit', rmSync.bind(null, work.dir, { recursive: true, force: true }));
await capture(work);
encode(work);
if (only === undefined) { prune(); verify(); }
process.exit(0);
