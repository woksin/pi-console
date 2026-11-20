import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function loadToken(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const path = resolve(directory, 'token');
  try { writeFileSync(path, randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
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
function checkSource(req: IncomingMessage, port: number) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes(req.headers.host ?? '')) throw new HttpError(403, 'Host not allowed');
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site request refused');
  if (!req.headers.origin) return;
  if (!hosts.map(host => `http://${host}`).includes(req.headers.origin)) throw new HttpError(403, 'Origin not allowed');
}
function exchangeToken(req: IncomingMessage, res: ServerResponse, url: URL, token: string) {
  if (!equalToken(url.searchParams.get('token')!, token)) throw new HttpError(401, 'Unauthorized');
  if (req.method !== 'GET') throw new HttpError(400, 'Token exchange requires GET');
  res.setHeader('Set-Cookie', `piConsoleToken=${token}; HttpOnly; SameSite=Strict; Path=/api/v0`);
  url.searchParams.delete('token');
  res.writeHead(303, { Location: url.pathname + url.search });
  res.end();
  return false;
}
function bearerToken(req: IncomingMessage) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return undefined;
  return authorization.slice(7);
}
function cookieToken(req: IncomingMessage) {
  const cookies = (req.headers.cookie ?? '').split(';').map(value => value.trim());
  return cookies.find(value => value.startsWith('piConsoleToken='))?.slice(15);
}
function checkBrowserRequest(req: IncomingMessage, url: URL) {
  const protectedRequest = req.method === 'POST' || url.pathname === '/api/v0/stream';
  if (protectedRequest && !req.headers.origin) throw new HttpError(403, 'Bearer token required without Origin');
  if (req.method !== 'POST') return;
  if (req.headers['x-pi-console-csrf'] !== '1') throw new HttpError(403, 'CSRF header required');
}
export function authenticate(req: IncomingMessage, res: ServerResponse, url: URL, credentials: { port: number; token: string }) {
  const { port, token } = credentials;
  checkSource(req, port);
  if (url.searchParams.has('token')) return exchangeToken(req, res, url, token);
  if (equalToken(bearerToken(req), token)) return true;
  if (!equalToken(cookieToken(req), token)) throw new HttpError(401, 'Unauthorized');
  checkBrowserRequest(req, url);
  return true;
}
