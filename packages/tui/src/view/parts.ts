import { displayWidth, clip, clipCells, graphemes, sanitize } from '@pi-console/viewmodels';
import type { StatusCell, TextWidth } from '@pi-console/viewmodels';
import type { Color } from './theme.ts';
import type { Line, Part } from './renderer.ts';

const isControl = (code: number): boolean => (code < 32 && code !== 10) || (code >= 127 && code <= 159);

/** Cheap pre-check so the common, clean string skips `sanitize`: any control character other than newline. */
const needsCleaning = (text: string): boolean => {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (isControl(code)) return true;
  }
  return false;
};

/**
 * The one place text becomes a part. Everything rendered goes through here, so daemon- and agent-authored text can never carry terminal
 * control sequences to the screen, whichever view or pane draws it.
 */
export const t = (text: string, color?: Color, extra: Partial<Part> = {}): Part => ({ text: needsCleaning(text) ? sanitize(text) : text, color, ...extra });
export const gap = (width = 1): Part => ({ text: ' '.repeat(width) });

export { pressureTone } from '@pi-console/viewmodels';

const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Status glyph and label. Colour is never the only carrier: the label always travels with it. `phase` drives the motion; without it (legends, counts) the resting contract glyph shows. */
export function statusParts(status: StatusCell, phase?: number, withLabel = true): Part[] {
  const working = status.status === 'working' || status.status === 'running';
  const urgent = status.status === 'needs-you';
  const glyph = working && phase !== undefined ? spinner[phase % spinner.length] : status.glyph;
  return [t(glyph, status.color, { bold: urgent && (phase ?? 0) % 2 === 0 }), ...(withLabel ? [t(` ${status.label}`, status.color)] : [])];
}

/** `████░░░░` meter, coloured by pressure. */
export function bar(percent: number, width: number, color: Color): Part[] {
  const filled = Math.round(Math.max(0, Math.min(100, percent)) / 100 * width);
  return [t('█'.repeat(filled), color), t('░'.repeat(width - filled), 'border')];
}

/** The cell position, not the current fill width, determines its shared ramp colour. */
export function pressureBar(percent: number, width: number): Line {
  const filled = Math.round(Math.max(0, Math.min(100, percent)) / 100 * width);
  const ticks = [Math.round(0.6 * (width - 1)), Math.round(0.8 * (width - 1))];
  return Array.from({ length: width }, (_, index) => {
    const position = index / Math.max(1, width - 1) * 100;
    return t(ticks.includes(index) ? '│' : index < filled ? '█' : '░', index < filled ? `pressure:${position}` : 'border');
  });
}

const total = (line: readonly Part[], measure: TextWidth) => measure(line.map(part => part.text).join(''));

/** Whether a style boundary divides a user-perceived character. */
function crossesGrapheme(line: readonly Part[]): boolean {
  let end = 0;
  const boundaries = new Set([0, ...graphemes(line.map(part => part.text).join('')).map(text => (end += text.length))]);
  let offset = 0;
  return line.some(part => { offset += part.text.length; return !boundaries.has(offset); });
}

function fitJoined(line: readonly Part[], width: number, background: Color | undefined, measure: TextWidth): Line {
  const clipped = clipCells(line.map(part => part.text).join(''), width, measure);
  let offset = 0;
  const out = line.flatMap(part => {
    const text = clipped.slice(offset, offset + part.text.length);
    offset += part.text.length;
    return text ? [{ ...part, text, background: part.background ?? background }] : [];
  });
  const padding = Math.max(0, width - measure(clipped));
  if (padding) out.push({ text: ' '.repeat(padding), background });
  return out;
}

/** Clips a line to `width` cells (ellipsis on the cut part) and pads it with spaces; `background` fills the whole width. */
export function fit(line: readonly Part[], width: number, background?: Color, measure: TextWidth = displayWidth): Line {
  if (crossesGrapheme(line)) return fitJoined(line, width, background, measure);
  const out: Part[] = [];
  let used = 0;
  for (const part of line) {
    const room = width - used;
    if (room <= 0) break;
    const length = measure(part.text);
    const text = length > room ? clip(part.text, room, measure) : part.text;
    out.push({ ...part, text, background: part.background ?? background });
    used += measure(text);
    if (length > room) break;
  }
  if (used < width) out.push({ text: ' '.repeat(width - used), background });
  return out;
}

/** Left part and right part on one line, with the gap between them filled. */
export interface CellBudget { width: number; measure?: TextWidth }
interface SplitStyle { background?: Color; measure?: TextWidth }
export function split(left: readonly Part[], right: readonly Part[], width: number, style?: Color | SplitStyle): Line {
  const { background, measure = displayWidth } = typeof style === 'object' ? style : { background: style };
  const room = Math.max(0, width - total(right, measure) - 1);
  return fit([...fit(left, room, undefined, measure), gap(), ...right], width, background, measure);
}

/** Marks the selected row: a cyan bar in the first column and the `select` background across the row. */
export function selectable(line: readonly Part[], width: number, selected: boolean, options: boolean | { flash?: boolean; measure?: TextWidth } = false): Line {
  const { flash = false, measure = displayWidth } = typeof options === 'boolean' ? { flash: options } : options;
  const background: Color | undefined = selected ? 'select' : flash ? 'flash' : undefined;
  return [t(selected ? '▌' : ' ', 'cyan', { background }), ...fit(line, width - 1, background, measure)];
}

/** The visible window of `length` rows that keeps `cursor` on screen, scrolling like a list, not a paginator. */
export function windowOf(length: number, cursor: number, height: number): { start: number; end: number } {
  const size = Math.max(1, height);
  const start = Math.max(0, Math.min(length - size, cursor - Math.floor(size * 0.6)));
  return { start, end: Math.min(length, start + size) };
}

export const heading = (text: string, color: Color = 'muted'): Line => [t(text.toUpperCase(), color, { bold: true })];
export const blank: Line = [t('')];
export const rule = (width: number, label = '', color: Color = 'border', measure: TextWidth = displayWidth): Line => {
  const text = label ? ` ${label} ` : '';
  const side = Math.max(0, Math.floor((width - measure(text)) / 2));
  return [t('─'.repeat(side) + text + '─'.repeat(Math.max(0, width - side - measure(text))), color)];
};
