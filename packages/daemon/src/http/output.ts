import type { ServerResponse } from 'node:http';
import { scanPatterns } from '@pi-console/adapters';
import { HttpError } from '../security/guard.ts';

// C0 and C1 control characters except tab and newline, plus bidirectional overrides: terminal escapes and
// "trojan source" reordering must never reach a TUI or a page through the API.
// eslint-disable-next-line no-control-regex -- matching control characters is the purpose of this pattern
const unsafeCharacters = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

/** Last line of defence at the API boundary: adapters redact at ingestion; this repeats the scan on the way out. */
export function safeText(text: string): string {
  return scanPatterns(text.replace(unsafeCharacters, ''));
}

/** JSON for every response body and SSE frame; every string value passes through `safeText`. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === 'string' ? safeText(item) : item));
}

/** Headers on every response, API and static alike. */
export function baseHeaders(res: ServerResponse): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
}

export const apiCsp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Security-Policy': apiCsp });
  res.end(safeJson(body));
}

/** `{error}` with the status of an `HttpError`; anything else is a 500 whose details stay in the process. */
export function sendError(res: ServerResponse, error: unknown): void {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof HttpError ? error.message : 'Internal error';
  if (res.headersSent) {
    res.destroy();
    return;
  }
  sendJson(res, status, { error: message });
}
