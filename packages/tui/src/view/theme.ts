import { themeColors, type ThemeToken } from '@pi-console/contract';

import { pressureColor } from '@pi-console/viewmodels';

export type Color = ThemeToken | `pressure:${number}`;
export type ColorDepth = '16' | '256' | 'truecolor';

const ansi16 = ['#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0', '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'];
const cube = [0, 95, 135, 175, 215, 255];
const ansi256 = [...ansi16,
  ...Array.from({ length: 216 }, (_, index) => `#${[Math.floor(index / 36), Math.floor(index / 6) % 6, index % 6].map(step => cube[step].toString(16).padStart(2, '0')).join('')}`),
  ...Array.from({ length: 24 }, (_, index) => `#${(8 + index * 10).toString(16).padStart(2, '0').repeat(3)}`)];

const channels = (hex: string): number[] => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));

/** Nearest colour in the terminal's palette; truecolor passes through. */
export function quantize(hex: string, depth: ColorDepth): string {
  if (depth === 'truecolor') return hex;
  const source = channels(hex);
  const distance = (color: string) => channels(color).reduce((sum, channel, index) => sum + (channel - source[index]) ** 2, 0);
  return (depth === '16' ? ansi16 : ansi256).reduce((best, color) => (distance(color) < distance(best) ? color : best));
}

export function detectDepth(env: NodeJS.ProcessEnv = process.env): ColorDepth {
  if (/truecolor|24bit/.test(env.COLORTERM ?? '')) return 'truecolor';
  return (env.TERM ?? '').includes('256') ? '256' : '16';
}

/** Module-level on purpose: set once at start-up, read by the renderer. */
class Palette {
  private colors: Record<ThemeToken, string> = themeColors(false);
  private source: Record<ThemeToken, string> = themeColors(false);
  private depth: ColorDepth = 'truecolor';
  configure(depth: ColorDepth, highContrast: boolean): void {
    this.source = themeColors(highContrast);
    this.depth = depth;
    this.colors = Object.fromEntries(Object.entries(themeColors(highContrast)).map(([token, hex]) => [token, quantize(hex, depth)])) as Record<ThemeToken, string>;
  }
  resolve(token: Color): string {
    if (!token.startsWith('pressure:')) return this.colors[token as ThemeToken];
    const color = pressureColor(Number(token.slice(9)), this.source);
    if (this.depth === 'truecolor') return color;
    const distance = (candidate: string) => channels(candidate).reduce((sum, value, index) => sum + (value - channels(color)[index]) ** 2, 0);
    const band = [this.source.green, this.source.amber, this.source.red].reduce((best, candidate) => distance(candidate) < distance(best) ? candidate : best);
    return quantize(band, this.depth);
  }
}
export const palette = new Palette();
