import { statusToken, type ThemeToken } from '@pi-console/contract';

/** One sample in the theme preview: what it says and which token draws it. */
export interface PreviewSample { text: string; color: ThemeToken }

/** The theme preview in Settings, the same samples in web and TUI: status words, the text levels and the pressure ramp. */
export interface ThemePreview { statuses: PreviewSample[]; text: PreviewSample[]; ramp: number[] }

const previewStatuses = ['needs-you', 'working', 'blocked', 'waiting', 'done', 'failed', 'idle'] as const;

export function themePreview(): ThemePreview {
  return {
    statuses: previewStatuses.map(status => {
      const token = statusToken(status);
      return { text: `${token.glyph} ${token.label}`, color: token.color };
    }),
    text: [{ text: 'Text', color: 'text' }, { text: 'Muted', color: 'muted' }, { text: 'Faint', color: 'faint' }],
    ramp: [0, 20, 40, 60, 80, 100],
  };
}
