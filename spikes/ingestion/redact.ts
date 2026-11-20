export interface ScannedText { text?: string; withheld: boolean }
export type Scanner = (text: string) => string;

// Deliberately conservative spike scanner, not a production secret detector.
export function scanPatterns(text: string): string {
    const patterns = [
        /\b(?:sk-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{8,}/g,
        /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
        /\b(?:api[_-]?key|password|secret|token)["']?\s*[:=]\s*["']?[^\s,"'}]+/gi,
        /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
    ];
    return patterns.reduce((value, pattern) => value.replace(pattern, '[REDACTED]'), text);
}

export function redact(text: string, scanner: Scanner = scanPatterns): ScannedText {
    try {
        const safe = scanner(text);
        if (typeof safe !== 'string') return { withheld: true };
        return { text: safe.slice(0, 200), withheld: false };
    } catch {
        // Never store the exception: it may itself include the input text.
        return { withheld: true };
    }
}
