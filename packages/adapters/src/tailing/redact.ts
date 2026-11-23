export interface RedactedText { text?: string; withheld: boolean; truncated?: true }
export type Scanner = (text: string) => string;

const patterns = [
  /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
  /\b(?:sk-|gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bAIza[A-Za-z0-9_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\b[A-Za-z0-9_]*(?:api[_-]?key|password|secret(?:_access_key)?|token|accountkey)["']?\s*[:=]\s*["']?[^\s,"'}]+/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s@]+@/gi,
];

export function scanPatterns(text: string): string {
  return patterns.reduce((safe, pattern) => safe.replace(pattern, '[REDACTED]'), text);
}

/** Scan before truncation: a secret crossing the excerpt boundary must not leak. */
export function redact(text: string, scanner: Scanner = scanPatterns): RedactedText {
  try {
    const safe = scanner(text);
    if (typeof safe !== 'string') return { withheld: true };
    return { text: safe.slice(0, 200), withheld: false, ...(safe.length > 200 ? { truncated: true as const } : {}) };
  } catch {
    return { withheld: true };
  }
}

/** Only plain JSON values arrive here; every string, not just the excerpt, is scanned. */
export function redactValue(value: unknown, scanner?: Scanner): unknown {
  if (typeof value === 'string') return redact(value, scanner).text ?? '[withheld]';
  if (Array.isArray(value)) return value.map((item: unknown) => redactValue(item, scanner));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]: [string, unknown]) => [
      redact(key, scanner).text ?? '[withheld]', redactValue(item, scanner),
    ]));
  }
  return value;
}
