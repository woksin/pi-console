import { dawnOverrides, themeColors, type ThemeToken } from '@pi-console/contract';

export type ThemeId = 'midnight' | 'dawn' | 'contrast';

export const themeIds: readonly ThemeId[] = ['midnight', 'dawn', 'contrast'];

export function colorsFor(theme: ThemeId): Record<ThemeToken, string> {
  const base = themeColors(theme === 'contrast');
  return theme === 'dawn' ? { ...base, ...dawnOverrides } : base;
}

/** Writes the shared tokens as CSS custom properties (CSSOM, so it works under a strict style-src). */
export function applyTheme(root: HTMLElement, theme: ThemeId, reducedMotion: boolean): void {
  for (const [token, color] of Object.entries(colorsFor(theme))) root.style.setProperty(`--${token}`, color);
  root.dataset.theme = theme;
  root.dataset.motion = reducedMotion ? 'reduced' : 'full';
}
