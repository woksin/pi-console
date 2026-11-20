import { themeColors, type ThemeToken } from '@pi-console/contract';

export type ThemeId = 'midnight' | 'dawn' | 'contrast';

const dawn: Partial<Record<ThemeToken, string>> = {
  bg: '#f4f6fa', panel: '#ffffff', raised: '#eaeff6', border: '#c5d0de', text: '#17202e', muted: '#46566c', faint: '#66768c',
  cyan: '#0a6d86', blue: '#3b4fd1', amber: '#8a5a00', green: '#1c7a43', red: '#b3263a', orange: '#a84b0d', violet: '#6b44c9', pink: '#a8307f',
  select: '#d7e6f5', flash: '#d8efdf',
};

export const themeIds: readonly ThemeId[] = ['midnight', 'dawn', 'contrast'];

export function colorsFor(theme: ThemeId): Record<ThemeToken, string> {
  const base = themeColors(theme === 'contrast');
  return theme === 'dawn' ? { ...base, ...dawn } : base;
}

/** Writes the shared tokens as CSS custom properties (CSSOM, so it works under a strict style-src). */
export function applyTheme(root: HTMLElement, theme: ThemeId, reducedMotion: boolean): void {
  for (const [token, color] of Object.entries(colorsFor(theme))) root.style.setProperty(`--${token}`, color);
  root.dataset.theme = theme;
  root.dataset.motion = reducedMotion ? 'reduced' : 'full';
}
