import { accentTokens, monoOverrides, themeColors, type ThemeToken } from '@pi-console/contract';

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

/** 'plain' is not selectable: it is what a non-empty NO_COLOR forces, and it emits no colour at all. */
export type TuiTheme = 'midnight' | 'contrast' | 'mono' | 'plain';
export const tuiThemes: readonly TuiTheme[] = ['midnight', 'contrast', 'mono'];

/** A non-empty NO_COLOR forces plain (no colour codes, no background). Otherwise PI_CONSOLE_THEME wins and the older PI_CONSOLE_HIGH_CONTRAST=1 still means contrast. */
export function themeFromEnv(env: NodeJS.ProcessEnv = process.env): TuiTheme {
  if (env.NO_COLOR) return 'plain';
  const named = tuiThemes.find(theme => theme === env.PI_CONSOLE_THEME);
  if (named) return named;
  if (env.PI_CONSOLE_HIGH_CONTRAST === '1') return 'contrast';
  return 'midnight';
}

const colorsOf = (theme: TuiTheme): Record<ThemeToken, string> => (theme === 'mono' || theme === 'plain' ? { ...monoOverrides } : themeColors(theme === 'contrast'));

/** Module-level on purpose: set once at start-up, read by the renderer. */
class Palette {
  private colors: Record<ThemeToken, string> = themeColors(false);
  private source: Record<ThemeToken, string> = themeColors(false);
  private depth: ColorDepth = 'truecolor';
  private current: TuiTheme = 'midnight';
  configure(depth: ColorDepth, theme: TuiTheme): void {
    this.current = theme;
    this.source = colorsOf(theme);
    this.depth = depth;
    this.colors = Object.fromEntries(Object.entries(this.source).map(([token, hex]) => [token, quantize(hex, depth)])) as Record<ThemeToken, string>;
  }
  get theme(): TuiTheme { return this.current; }
  /** True when no colour may be emitted: the terminal's own foreground and background are used. */
  get plain(): boolean { return this.current === 'plain'; }
  /** Mono and plain carry meaning by glyphs and weight rather than hue. */
  get monochrome(): boolean { return this.current === 'mono' || this.plain; }
  /** Text drawn in an accent token is bold when hue is not available. */
  emphasised(token: Color): boolean { return this.monochrome && accentTokens.includes(token as ThemeToken); }
  /** Plain marks a filled background (selection, flash, badges) with inverse video instead of colour. */
  inverted(background: Color | undefined): boolean { return this.plain && background !== undefined && (background === 'select' || background === 'flash' || accentTokens.includes(background as ThemeToken)); }
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
