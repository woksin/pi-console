import { clip, sanitize } from '../format/format.ts';

export interface TitleInput {
  /** Items in the needs-you inbox. */
  needsYou: number;
  /** Where the user is: a section label or the open session's name. Untrusted; sanitised here. */
  place?: string;
}

/** Every C0 and C1 control character, DEL, and the bidirectional overrides that could reorder a title. */
// eslint-disable-next-line no-control-regex -- matching control characters is the purpose of this pattern
const controls = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** Safe for a window title or a terminal OSC 2 sequence: escape sequences and control characters removed, one line, at most 60 cells. */
export function titleText(text: string): string {
  return clip(sanitize(text).replace(controls, ' ').replace(/\s+/g, ' ').trim(), 60);
}

/** `(3) Overview · pi console`: the needs-you count first so it survives a narrow tab; no count when nothing needs you. */
export function consoleTitle(input: TitleInput): string {
  const count = input.needsYou > 0 ? `(${input.needsYou > 99 ? '99+' : String(input.needsYou)}) ` : '';
  const place = titleText(input.place ?? '');
  return `${count}${place ? `${place} · ` : ''}pi console`;
}
