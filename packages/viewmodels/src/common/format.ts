import { statusToken, type StatusToken } from '@pi-console/contract';

/* eslint-disable no-control-regex -- stripping control characters is the point of this module */
const controlSequences = /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g;
const controlCharacters = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g;
/* eslint-enable no-control-regex */

/** Strips terminal escape sequences, control characters and bidi overrides from daemon text (docs/security.md). */
export function clean(text: string): string {
  return text.replace(controlSequences, '').replace(controlCharacters, '');
}

/** One-line, sanitised, length-bounded text. */
export function clip(text: string, width: number): string {
  const chars = Array.from(clean(text).replace(/\s*\n\s*/g, ' ').trim());
  return chars.length > width ? `${chars.slice(0, Math.max(0, width - 1)).join('')}…` : chars.join('');
}

/** Compact age such as `now`, `3m`, `2h`, `4d`, relative to `now` (epoch ms). */
export function age(now: number, iso: string): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 45) return 'now';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/** UTC wall-clock `HH:MM`; UTC keeps golden snapshots independent of the machine time zone. */
export function clock(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16);
}

export function clockSeconds(iso: string): string {
  return new Date(iso).toISOString().slice(11, 19);
}

const blocks = '▁▂▃▄▅▆▇█';

/** Block sparkline for the TUI; the web draws the same numbers as SVG. */
export function sparkline(values: readonly number[]): string {
  if (values.length === 0) return '';
  const low = Math.min(...values);
  const span = Math.max(...values) - low;
  return values.map(value => blocks[span === 0 ? 3 : Math.round((value - low) / span * (blocks.length - 1))]).join('');
}

export type PressureLevel = 'ok' | 'warn' | 'high';

/** Context-pressure ticks: soft threshold and handoff threshold, drawn on bars. */
export const pressureThresholds = { soft: 70, handoff: 85 } as const;

export interface Pressure { percent: number; level: PressureLevel; text: string; label: string }

export function pressure(percent: number): Pressure {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  const level: PressureLevel = value >= pressureThresholds.handoff ? 'high' : value >= pressureThresholds.soft ? 'warn' : 'ok';
  const filled = Math.round(value / 10);
  return { percent: value, level, text: `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`, label: `${String(value)}%` };
}

export interface Badge extends StatusToken { status: string }

export function badge(status: string): Badge {
  return { status, ...statusToken(status) };
}

export const plural = (count: number, one: string, many = `${one}s`): string => `${String(count)} ${count === 1 ? one : many}`;

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function money(value: number): string {
  return `$${value.toFixed(2)}`;
}
