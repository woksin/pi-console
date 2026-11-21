import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

/** The policy the daemon's static route must also apply: same-origin only, no inline script or style, no framing. */
export const contentSecurityPolicy = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "font-src 'self'", "connect-src 'self'",
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "object-src 'none'",
].join('; ');

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

const securityHeaders = {
  'Content-Security-Policy': contentSecurityPolicy, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin',
};

export interface StaticServerOptions { root: string; daemon: { host: string; port: number } }

/** Resolves a URL path inside `root`, falling back to the SPA shell when present, or null if neither file exists. */
async function fileFor(root: string, pathname: string): Promise<string | null> {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const candidate = resolve(root, relative);
  const inside = candidate === root || candidate.startsWith(root + sep);
  const found = inside && await stat(candidate).then(info => info.isFile(), () => false);
  if (found) return candidate;
  const shell = join(root, 'index.html');
  return stat(shell).then(info => info.isFile() ? shell : null, () => null);
}

/** The daemon only accepts its own host and origin (DNS-rebinding and CSRF defence), so the dev proxy presents itself as that origin. */
function upstreamHeaders(options: StaticServerOptions, req: IncomingMessage): IncomingMessage['headers'] {
  const authority = `${options.daemon.host}:${String(options.daemon.port)}`;
  const headers = { ...req.headers, host: authority };
  if (headers.origin) headers.origin = `http://${authority}`;
  return headers;
}

/** A request is local only if it names this server by a loopback host and its own port; a rebinding page or another origin is refused before anything is forwarded. */
function isLocalRequest(req: IncomingMessage): boolean {
  const port = String(req.socket.localPort);
  const own = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  const { host, origin } = req.headers;
  return host !== undefined && own.includes(host) && (origin === undefined || origin === `http://${host}`);
}

function proxy(options: StaticServerOptions, req: IncomingMessage, res: ServerResponse): void {
  if (!isLocalRequest(req)) { res.writeHead(403, securityHeaders).end(); return; }
  const upstream = httpRequest({ host: options.daemon.host, port: options.daemon.port, method: req.method, path: req.url, headers: upstreamHeaders(options, req) }, reply => {
    res.writeHead(reply.statusCode ?? 502, { ...reply.headers, ...securityHeaders });
    reply.pipe(res);
    // A daemon that dies mid-stream (SSE) must drop the browser connection too, or the client never learns it is offline.
    reply.on('close', () => { if (!reply.complete) res.destroy(); });
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'daemon unreachable' })); });
  res.on('close', () => { upstream.destroy(); });
  req.pipe(upstream);
}

function serveFile(file: string | null, req: IncomingMessage, res: ServerResponse): void {
  if (file === null) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders });
    res.end('Web bundle unavailable. Run npm run build -w @pi-console/web.\n');
    return;
  }
  const cache = file.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable';
  const headers = { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': cache, ...securityHeaders };
  if (req.method === 'HEAD') { res.writeHead(200, headers).end(); return; }
  const stream = createReadStream(file);
  stream.once('open', () => { res.writeHead(200, headers); });
  stream.on('error', () => {
    if (res.headersSent) res.destroy(); else res.writeHead(500, securityHeaders).end();
  });
  stream.pipe(res);
}

/** The request target, or null when it is not a parseable URL (e.g. `//[`). */
function parseTarget(target: string | undefined): URL | null {
  try { return new URL(target ?? '/', 'http://localhost'); } catch { return null; }
}

/** Serves the built bundle with the strict CSP and forwards `/api` (including the SSE stream) to the daemon. */
export function createStaticServer(options: StaticServerOptions): Server {
  const root = resolve(options.root);
  return createServer((req, res) => {
    const url = parseTarget(req.url);
    if (!url) { res.writeHead(400, securityHeaders).end(); return; }
    if (url.pathname.startsWith('/api/')) { proxy(options, req, res); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, securityHeaders).end(); return; }
    void fileFor(root, url.pathname).then(file => { serveFile(file, req, res); }, () => { res.writeHead(400, securityHeaders).end(); });
  });
}
