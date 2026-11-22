import type { IncomingMessage } from 'node:http';
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

/** Mutating requests need a cookie-free proof of intent from a browser. M1 has none; the guard stays specified. */
export function checkCsrf(req: IncomingMessage): void {
  if (header(req, 'x-pi-console-csrf') !== '1') throw new HttpError(403, 'CSRF header required');
  if (header(req, 'origin') === undefined) throw new HttpError(403, 'Origin required');
}

export function hasControlScope(req: IncomingMessage, credentials: Credentials): boolean {
  return credentials.controls(bearerToken(req));
}

/** Normal bearer policy applies; scope never serves as human proof. */
export function authenticateControl(req: IncomingMessage, url: URL, credentials: Credentials): string {
  authenticate(req, url, credentials);
  if (!hasControlScope(req, credentials)) throw new HttpError(403, 'Control scope required');
  return credentials.controlId();
}

/** Only bearer headers authenticate; Host, Origin and fetch metadata are checked separately. */
export function authenticate(req: IncomingMessage, url: URL, credentials: Credentials): void {
  if (!credentials.verify(bearerToken(req))) throw new HttpError(401, 'Unauthorized');
}
