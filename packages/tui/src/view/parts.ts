import { cells, clip, sanitize, type Pressure } from '@pi-console/viewmodels';
import type { StatusCell } from '@pi-console/viewmodels';
import type { Color } from './theme.ts';
import type { Line, Part } from './renderer.ts';

/** Cheap pre-check so the common, clean string skips `sanitize`: any control character other than newline. */
const needsCleaning = (text: string): boolean => {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if ((code < 32 && code !== 10) || (code >= 127 && code <= 159)) return true;
  }
  return false;
};

/**
 * The one place text becomes a part. Everything rendered goes through here, so daemon- and agent-authored text can never carry terminal
 * control sequences to the screen, whichever view or pane draws it.
 */
export const t = (text: string, color?: Color, extra: Partial<Part> = {}): Part => ({ text: needsCleaning(text) ? sanitize(text) : text, color, ...extra });
export const gap = (width = 1): Part => ({ text: ' '.repeat(width) });

const pressureColor: Record<Pressure, Color> = { calm: 'green', warm: 'amber', hot: 'red' };
export const pressureTone = (pressure: Pressure): Color => pressureColor[pressure];

const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Status glyph and label. Colour is never the only carrier: the label always travels with it. `phase` drives the motion. */
export function statusParts(status: StatusCell, phase = 0, withLabel = true): Part[] {
  const working = status.status === 'working' || status.status === 'running';
  const urgent = status.status === 'needs-you';
  const glyph = working ? spinner[phase % spinner.length] : status.glyph;
  return [t(glyph, status.color, { bold: urgent && phase % 2 === 0 }), ...(withLabel ? [t(` ${status.label}`, status.color)] : [])];
}

/** `████░░░░` meter, coloured by pressure. */
export function bar(percent: number, width: number, color: Color): Part[] {
  const filled = Math.round(Math.max(0, Math.min(100, percent)) / 100 * width);
  return [t('█'.repeat(filled), color), t('░'.repeat(width - filled), 'border')];
}

const total = (line: readonly Part[]) => line.reduce((sum, part) => sum + cells(part.text).length, 0);

/** Clips a line to `width` cells (ellipsis on the cut part) and pads it with spaces; `background` fills the whole width. */
export function fit(line: readonly Part[], width: number, background?: Color): Line {
  const out: Part[] = [];
  let used = 0;
  for (const part of line) {
    const room = width - used;
    if (room <= 0) break;
    const length = cells(part.text).length;
    const text = length > room ? clip(part.text, room) : part.text;
    out.push({ ...part, text, background: part.background ?? background });
    used += cells(text).length;
    if (length > room) break;
  }
  if (used < width) out.push({ text: ' '.repeat(width - used), background });
  return out;
}

/** Left part and right part on one line, with the gap between them filled. */
export function split(left: readonly Part[], right: readonly Part[], width: number, background?: Color): Line {
  const room = Math.max(0, width - total(right) - 1);
  return fit([...fit(left, room), gap(), ...right], width, background);
}

/** Marks the selected row: a cyan bar in the first column and the `select` background across the row. */
export function selectable(line: readonly Part[], width: number, selected: boolean, flash = false): Line {
  const background: Color | undefined = selected ? 'select' : flash ? 'flash' : undefined;
  return [t(selected ? '▌' : ' ', 'cyan', { background }), ...fit(line, width - 1, background)];
}

/** The visible window of `length` rows that keeps `cursor` on screen, scrolling like a list, not a paginator. */
export function windowOf(length: number, cursor: number, height: number): { start: number; end: number } {
  const size = Math.max(1, height);
  const start = Math.max(0, Math.min(length - size, cursor - Math.floor(size * 0.6)));
  return { start, end: Math.min(length, start + size) };
}

export const heading = (text: string, color: Color = 'muted'): Line => [t(text.toUpperCase(), color, { bold: true })];
export const blank: Line = [t('')];
export const rule = (width: number, label = '', color: Color = 'border'): Line => {
  const text = label ? ` ${label} ` : '';
  const side = Math.max(0, Math.floor((width - cells(text).length) / 2));
  return [t('─'.repeat(side) + text + '─'.repeat(Math.max(0, width - side - cells(text).length)), color)];
};
