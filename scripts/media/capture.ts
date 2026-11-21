// What a scene writes into the work directory: still PNGs, or numbered frame PNGs with a hold time each.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Work { dir: string; only: string | undefined }

export const wanted = (work: Work, id: string): boolean => work.only === undefined || id.startsWith(work.only);

export function writeStill(work: Work, id: string, png: Buffer): void {
  writeFileSync(join(work.dir, `${id}.png`), png);
  console.log(`  captured ${id}`);
}

/** Frames are held for a fixed time each (never wall-clock), so the same run always encodes the same animation. */
export class FrameSet {
  private readonly dir: string;
  private readonly frames: { file: string; ms: number }[] = [];
  private readonly id: string;

  constructor(work: Work, id: string) {
    this.id = id;
    this.dir = join(work.dir, id);
    mkdirSync(this.dir, { recursive: true });
  }

  add(png: Buffer, ms: number): void {
    const file = `frame-${String(this.frames.length + 1).padStart(4, '0')}.png`;
    writeFileSync(join(this.dir, file), png);
    this.frames.push({ file, ms });
  }

  /** ffmpeg concat list; the last frame is listed twice because the demuxer ignores the final duration. */
  finish(): void {
    const lines = this.frames.flatMap(frame => [`file '${frame.file}'`, `duration ${(frame.ms / 1000).toFixed(3)}`]);
    const last = this.frames.at(-1);
    if (last) lines.push(`file '${last.file}'`);
    writeFileSync(join(this.dir, 'frames.txt'), `${lines.join('\n')}\n`);
    console.log(`  captured ${this.id} (${String(this.frames.length)} frames)`);
  }
}
