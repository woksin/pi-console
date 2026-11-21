/** Colour tokens shared by web (CSS custom properties) and TUI (quantised per terminal capability). */
export const themeTokens = {
  bg: '#0b1019', panel: '#101925', raised: '#172434', border: '#2b3b50', 'border-strong': '#667d96', 'hot-text': '#1c1300',
  text: '#d8e2ef', muted: '#8b9eb5', faint: '#7a8fa8', cyan: '#66d9ef',
  blue: '#819cff', amber: '#f5bf65', green: '#85d9a0', red: '#fa7989',
  orange: '#f49b6c', violet: '#b49afa', pink: '#e996d0', select: '#203c50', flash: '#32413b',
} as const;

export type ThemeToken = keyof typeof themeTokens;

/** Light surfaces and semantic colours; clients never define their own palette. */
export const dawnOverrides: Partial<Record<ThemeToken, string>> = {
  bg: '#f4f6fa', panel: '#ffffff', raised: '#eaeff6', border: '#c5d0de', 'border-strong': '#78879a', 'hot-text': '#ffffff',
  text: '#17202e', muted: '#46566c', faint: '#5e6e82',
  cyan: '#0a6d86', blue: '#3b4fd1', amber: '#8a5a00', green: '#1c7a43', red: '#b3263a', orange: '#a84b0d', violet: '#6b44c9', pink: '#a8307f',
  select: '#d7e6f5', flash: '#d8efdf',
};

/** Overrides applied on top of the base tokens for the high-contrast variant. */
export const highContrastOverrides: Partial<Record<ThemeToken, string>> = {
  bg: '#000000', panel: '#000000', text: '#ffffff', muted: '#c0c0c0', border: '#819cff',
};

export function themeColors(highContrast = false): Record<ThemeToken, string> {
  return { ...themeTokens, ...(highContrast ? highContrastOverrides : {}) };
}
