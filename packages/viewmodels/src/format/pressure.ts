import { themeTokens, type ThemeToken } from '@pi-console/contract';

import type { Pressure } from './format.ts';

const pressureTokens: Record<Pressure, ThemeToken> = { calm: 'green', warm: 'amber', hot: 'red' };
export const pressureTone = (pressure: Pressure): ThemeToken => pressureTokens[pressure];

interface RampColors { green: string; amber: string; red: string }
type Triple = readonly [number, number, number];
const radians = Math.PI / 180;
const linear = (value: number): number => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const encoded = (value: number): number => value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;

/** sRGB → OKLCH, using the D65 OKLab matrices. */
function toLch(hex: string): Triple {
  const [r, g, b] = [1, 3, 5].map(offset => linear(parseInt(hex.slice(offset, offset + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, Math.hypot(a, bb), Math.atan2(bb, a) / radians];
}

function fromLch([lightness, chroma, hue]: Triple): string {
  const a = chroma * Math.cos(hue * radians);
  const b = chroma * Math.sin(hue * radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return `#${rgb.map(value => Math.round(Math.max(0, Math.min(1, encoded(value))) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Shorter-hue OKLCH interpolation; calm at 0%, soft at 60%, handoff at 80% and above. */
export function pressureColor(percent: number, colors: RampColors = themeTokens): string {
  const pct = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  if (pct === 0) return colors.green;
  if (pct === 60) return colors.amber;
  if (pct >= 80) return colors.red;
  const [start, end, fraction] = pct < 60 ? [colors.green, colors.amber, pct / 60] : [colors.amber, colors.red, (pct - 60) / 20];
  const a = toLch(start);
  const b = toLch(end);
  const hue = ((b[2] - a[2] + 540) % 360) - 180;
  return fromLch([a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction, a[2] + hue * fraction]);
}

/** Dense shared stops keep browser interpolation faithful to the terminal's per-cell ramp. */
export function pressureGradient(colors: RampColors = themeTokens): string {
  return `linear-gradient(90deg, ${Array.from({ length: 101 }, (_, pct) => `${pressureColor(pct, colors)} ${String(pct)}%`).join(', ')})`;
}
