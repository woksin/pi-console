import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Credentials } from './token.ts';

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const apiPrefix = '/api/v1';
export const streamPath = `${apiPrefix}/stream`;
const cookieName = 'piConsoleToken';

const header = (req: IncomingMessage, name: string): string | undefined => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/** Loopback names only. Anything else (DNS rebinding, a LAN name, forwarded hosts) is refused. */
export function allowedHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

/** Host allowlist, exact Origin match when present, and no cross-site fetches. Applies to every path. */
export function checkSource(req: IncomingMessage, port: number): void {
  const hosts = allowedHosts(port);
  if (!hosts.includes(header(req, 'host') ?? '')) throw new HttpError(403, 'Host not allowed');
  if (header(req, 'sec-fetch-site') === 'cross-site') throw new HttpError(403, 'Cross-site request refused');
  const origin = header(req, 'origin');
  if (origin === undefined) return;
  if (!hosts.some(host => origin === `http://${host}`)) throw new HttpError(403, 'Origin not allowed');
}

function bearerToken(req: IncomingMessage): string | undefined {
  const authorization = header(req, 'authorization');
  return authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
}

function cookieToken(req: IncomingMessage): string | undefined {
  const cookies = (header(req, 'cookie') ?? '').split(';').map(value => value.trim());
  const prefix = `${cookieName}=`;
  return cookies.find(value => value.startsWith(prefix))?.slice(prefix.length);
}

/**
 * Browser bootstrap: `GET <any path>?token=<token>` sets an HttpOnly, SameSite=Strict cookie scoped to the API and
 * redirects to the same URL without the token. The response never carries the requested body.
 */
export function exchangeToken(req: IncomingMessage, res: ServerResponse, url: URL, credentials: Credentials): void {
  const candidate = url.searchParams.get('token') ?? undefined;
  if (!credentials.verify(candidate)) throw new HttpError(401, 'Unauthorized');
  if (req.method !== 'GET') throw new HttpError(400, 'Token exchange requires GET');
  url.searchParams.delete('token');
  res.writeHead(303, {
    'Set-Cookie': `${cookieName}=${String(candidate)}; HttpOnly; SameSite=Strict; Path=${apiPrefix}`,
    Location: url.pathname + url.search,
  });
  res.end();
}

/** Mutating requests need a cookie-free proof of intent from a browser. M1 has none; the guard stays specified. */
export function checkCsrf(req: IncomingMessage): void {
  if (header(req, 'x-pi-console-csrf') !== '1') throw new HttpError(403, 'CSRF header required');
  if (header(req, 'origin') === undefined) throw new HttpError(403, 'Origin required');
}

const mutating = (method: string | undefined): boolean => !['GET', 'HEAD'].includes(method ?? 'GET');

/**
 * A valid bearer bypasses the cookie-only Origin and CSRF requirements here; checkBrowserPolicy still applies.
 * Cookie-authenticated streams and mutations require Origin, and cookie-authenticated mutations also require
 * the CSRF header. A cookie alone never opens SSE from a context without Origin.
 */
export function authenticate(req: IncomingMessage, url: URL, credentials: Credentials): void {
  if (credentials.verify(bearerToken(req))) return;
  if (!credentials.verify(cookieToken(req))) throw new HttpError(401, 'Unauthorized');
  const needsOrigin = mutating(req.method) || url.pathname === streamPath;
  if (needsOrigin && header(req, 'origin') === undefined) throw new HttpError(403, 'Bearer token required without Origin');
  if (mutating(req.method)) checkCsrf(req);
}
