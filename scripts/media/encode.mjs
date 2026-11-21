// Encoding: ffmpeg for scaling and GIFs, cwebp for stills. Flags are chosen so the same frames always give the same bytes.
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const bitexact = ['-fflags', '+bitexact', '-flags', '+bitexact', '-map_metadata', '-1'];

export function have(tool) {
  return spawnSync(tool, ['-version'], { stdio: 'ignore' }).status === 0 || spawnSync(tool, ['-h'], { stdio: 'ignore' }).status === 0;
}

function run(tool, args) {
  const result = spawnSync(tool, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${tool} failed: ${(result.stderr || result.stdout).split('\n').slice(-6).join('\n')}`);
}

/** PNG (shot at 2x) -> lossy WebP `width` pixels wide, Lanczos-scaled. */
export function encodeStill(png, out, width, quality = 84) {
  const scaled = `${out}.png`;
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-vf', `scale=${String(width)}:-2:flags=lanczos`, ...bitexact, scaled]);
  run('cwebp', ['-quiet', '-q', String(quality), '-m', '6', '-alpha_q', '90', scaled, '-o', out]);
  rmSync(scaled, { force: true });
}

/** A frames.txt concat list -> a GIF with one shared 96-colour palette, bayer dithering and rectangle diffs. */
export function encodeGif(frameDir, out, width, fps, colors = 96) {
  const filter = `fps=${String(fps)},scale=${String(width)}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=${String(colors)}[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
  const manifest = join(frameDir, 'frames.txt');
  const duration = [...readFileSync(manifest, 'utf8').matchAll(/^duration (\d+\.\d+)$/gm)].reduce((total, match) => total + Number(match[1]), 0);
  // The concat sentinel can inherit the previous hold; end at the scripted duration, not that padding.
  run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', manifest, '-filter_complex', filter, ...bitexact, '-t', String(duration), '-loop', '0', out]);
}
