// C0 and C1 control characters except tab and newline, plus bidirectional overrides: terminal escapes and
// "trojan source" reordering must never reach a TUI or a page through the API.
// eslint-disable-next-line no-control-regex -- matching control characters is the purpose of this pattern
export const unsafeCharacters = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

/** The text with every unsafe character removed, exactly as the API boundary does it. */
export function stripUnsafeCharacters(text: string): string {
  return text.replace(unsafeCharacters, '');
}
