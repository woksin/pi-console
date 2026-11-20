import { statusToken, type ThemeToken } from '@pi-console/contract';

/** A status word with its shared glyph, colour token and label; the label always travels with the glyph. */
export interface StatusCell { status: string; glyph: string; color: ThemeToken; label: string }

export function statusCell(status: string): StatusCell {
  const token = statusToken(status);
  return { status, glyph: token.glyph, color: token.color, label: token.label };
}
