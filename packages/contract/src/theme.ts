/** Colour tokens shared by web (CSS custom properties) and TUI (quantised per terminal capability). */
export const themeTokens = {
  bg: '#0b1019', panel: '#101925', raised: '#172434', border: '#2b3b50',
  text: '#d8e2ef', muted: '#8b9eb5', faint: '#627992', cyan: '#66d9ef',
  blue: '#819cff', amber: '#f5bf65', green: '#85d9a0', red: '#fa7989',
  orange: '#f49b6c', violet: '#b49afa', pink: '#e996d0', select: '#203c50', flash: '#32413b',
} as const;

export type ThemeToken = keyof typeof themeTokens;

/** Overrides applied on top of the base tokens for the high-contrast variant. */
export const highContrastOverrides: Partial<Record<ThemeToken, string>> = {
  bg: '#000000', panel: '#000000', text: '#ffffff', muted: '#c0c0c0', border: '#819cff',
};

export function themeColors(highContrast = false): Record<ThemeToken, string> {
  return { ...themeTokens, ...(highContrast ? highContrastOverrides : {}) };
}
