import type { ServerResponse } from 'node:http';
import { scanPatterns } from '@pi-console/adapters';
import { stripUnsafeCharacters } from '@pi-console/contract';
import { HttpError } from '../security/guard.ts';

/** Last line of defence at the API boundary: adapters redact at ingestion; this repeats the scan on the way out. */
export function safeText(text: string): string {
  return scanPatterns(stripUnsafeCharacters(text));
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
