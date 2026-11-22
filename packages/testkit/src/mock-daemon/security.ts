import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
function createTokenFile(path: string) {
  try { writeFileSync(path, randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
}
export function loadToken(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const path = resolve(directory, 'token');
  createTokenFile(path);
  chmodSync(path, 0o600);
  const token = readFileSync(path, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid development token file');
  return token;
}
function equalToken(candidate: string | undefined, token: string) {
  const bytes = Buffer.from(candidate ?? '');
  const expected = Buffer.from(token);
  return bytes.length === expected.length && timingSafeEqual(bytes, expected);
}
const allowedHosts = (port: number) => [`127.0.0.1:${port}`, `localhost:${port}`];
function refuseUnless(allowed: boolean, message: string) {
  if (!allowed) throw new HttpError(403, message);
}
function checkSource(req: IncomingMessage, port: number) {
  const hosts = allowedHosts(port);
  refuseUnless(hosts.includes(req.headers.host ?? ''), 'Host not allowed');
  refuseUnless(req.headers['sec-fetch-site'] !== 'cross-site', 'Cross-site request refused');
  const origins = hosts.map(host => `http://${host}`);
  refuseUnless(!req.headers.origin || origins.includes(req.headers.origin), 'Origin not allowed');
}
function bearerToken(req: IncomingMessage) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return undefined;
  return authorization.slice(7);
}
export function authenticate(req: IncomingMessage, res: ServerResponse, url: URL, credentials: { port: number; token: string }) {
  const { port, token } = credentials;
  checkSource(req, port);
  if (!equalToken(bearerToken(req), token)) throw new HttpError(401, 'Unauthorized');
  return true;
}
