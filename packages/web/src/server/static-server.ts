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

/** Resolves a URL path inside `root`; anything that escapes it (or is not a file) falls back to the SPA shell. */
async function fileFor(root: string, pathname: string): Promise<string> {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const candidate = resolve(root, relative);
  const inside = candidate === root || candidate.startsWith(root + sep);
  const found = inside && await stat(candidate).then(info => info.isFile(), () => false);
  return found ? candidate : join(root, 'index.html');
}

/** The daemon only accepts its own host and origin (DNS-rebinding and CSRF defence), so the dev proxy presents itself as that origin. */
function upstreamHeaders(options: StaticServerOptions, req: IncomingMessage): IncomingMessage['headers'] {
  const authority = `${options.daemon.host}:${String(options.daemon.port)}`;
  const headers = { ...req.headers, host: authority };
  if (headers.origin) headers.origin = `http://${authority}`;
  return headers;
}

function proxy(options: StaticServerOptions, req: IncomingMessage, res: ServerResponse): void {
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

/** Serves the built bundle with the strict CSP and forwards `/api` (including the SSE stream) to the daemon. */
export function createStaticServer(options: StaticServerOptions): Server {
  const root = resolve(options.root);
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) { proxy(options, req, res); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, securityHeaders).end(); return; }
    void fileFor(root, url.pathname).then(file => {
      const cache = file.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable';
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': cache, ...securityHeaders });
      if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
    }, () => { res.writeHead(400, securityHeaders).end(); });
  });
}
