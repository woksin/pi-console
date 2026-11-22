import { readFile, realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, sep } from 'node:path';
import { HttpError } from '../security/guard.ts';

/**
 * Strict page policy for the web bundle: same-origin scripts, styles, images, fonts and API calls only; no inline
 * script or style, no eval, no framing, no plugins, no form posts, no base rewriting.
 */
export const pageCsp = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "font-src 'self'",
  "connect-src 'self'", "manifest-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

const types = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.map': 'application/json; charset=utf-8',
}));

/** Said at startup and in the bundle-missing response; never carries the token. */
export const apiOnlyHint = 'API only: start with --web-dist <path to packages/web/dist> to serve the web console';

async function existingFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function relativePath(url: URL): string {
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, 'Invalid path');
  }
  const segments = path.split('/').filter(segment => segment !== '');
  if (path.includes('\0') || segments.some(unsafeSegment)) throw new HttpError(400, 'Invalid path');
  return segments.join(sep);
}

const unsafeSegment = (segment: string): boolean => segment === '..' || segment.includes('\\');

/** The file to serve: the exact asset, else `index.html` for extensionless client routes (SPA fallback). */
async function resolveFile(root: string, url: URL): Promise<string | undefined> {
  const relative = relativePath(url);
  const candidate = join(root, relative);
  if (await existingFile(candidate)) return candidate;
  if (extname(relative) !== '') return undefined;
  const index = join(root, 'index.html');
  return (await existingFile(index)) ? index : undefined;
}

/** Symlinks inside the bundle must not lead outside it. */
async function inside(root: string, file: string): Promise<boolean> {
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(file)]);
  return realFile.startsWith(realRoot + sep);
}

/** The servable file inside `root` for the URL, or undefined. */
async function servable(root: string, url: URL): Promise<string | undefined> {
  const file = await resolveFile(root, url);
  return file !== undefined && (await inside(root, file)) ? file : undefined;
}

function notFound(res: ServerResponse, message: string): void {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Security-Policy': pageCsp });
  res.end(message);
}

/** True when `webDist` is set and `serveStatic` can serve its `index.html` (a regular file inside the bundle); the same check the server applies. */
export async function isUsableWebBundle(webDist: string | undefined): Promise<boolean> {
  if (webDist === undefined) return false;
  try {
    return (await servable(webDist, new URL('http://127.0.0.1/'))) !== undefined;
  } catch {
    return false;
  }
}

/** Serves the built web bundle from `root`. A missing or unusable bundle is a plain 404 with a hint, not an error. */
export async function serveStatic(root: string | undefined, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (!['GET', 'HEAD'].includes(req.method ?? '')) throw new HttpError(405, 'Method not allowed');
  const file = root === undefined ? undefined : await servable(root, url);
  if (root === undefined || file === undefined) {
    notFound(res, (await isUsableWebBundle(root)) ? 'Not found\n' : `Web bundle not available. ${apiOnlyHint}\n`);
    return;
  }
  const body = await readFile(file);
  res.writeHead(200, {
    'Content-Type': types.get(extname(file)) ?? 'application/octet-stream', 'Content-Length': body.length,
    'Content-Security-Policy': pageCsp,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}
