import type { IncomingMessage, ServerResponse } from 'node:http';
import { identifier } from '@pi-console/contract';
import { sendJson } from '../http/output.ts';
import { authenticateControl, hasControlScope, HttpError } from '../security/guard.ts';
import type { Credentials } from '../security/token.ts';
import { memoryActionsPath, type MemoryActions } from './actions.ts';
import { unavailableReview } from './availability.ts';

interface Parts { credentials: Credentials; actions(): MemoryActions | undefined }
const sessionRoute = /^\/api\/v1\/sessions\/([^/]+)\/memory-actions$/u;
export function isMemoryApiPath(url: URL): boolean {
  return url.pathname === memoryActionsPath || url.pathname.startsWith(`${memoryActionsPath}/`) || sessionRoute.test(url.pathname);
}
function routeSession(url: URL): string | undefined {
  const match = sessionRoute.exec(url.pathname);
  if (!match) return;
  if (!identifier(match[1])) throw new HttpError(404, 'Session not found');
  return match[1];
}
function receiptId(url: URL): string {
  const id = url.pathname.slice(memoryActionsPath.length + 1);
  if (!identifier(id)) throw new HttpError(405, 'Method not allowed');
  return id;
}
function availability(parts: Parts, req: IncomingMessage, sessionId: string) {
  const actions = parts.actions();
  if (!actions) return unavailableReview('disabled');
  if (!hasControlScope(req, parts.credentials)) return unavailableReview('read-only');
  return actions.availability(sessionId);
}
async function controlResponse(actions: MemoryActions, req: IncomingMessage, url: URL, tokenId: string): Promise<{ status: number; value: unknown }> {
  const sessionId = routeSession(url);
  if (sessionId !== undefined) return postResponse(actions, req, { sessionId, tokenId });
  if (req.method === 'GET') return { status: 200, value: actions.receipt(receiptId(url), tokenId) };
  throw new HttpError(405, 'Method not allowed');
}
async function postResponse(actions: MemoryActions, req: IncomingMessage, target: { sessionId: string; tokenId: string }) {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  return { status: 202, value: await actions.post(req, target.tokenId, target.sessionId) };
}
/** Normal read authentication and Host/Origin validation have already run. */
export async function memoryApi(parts: Parts, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const sessionId = routeSession(url);
  if (req.method === 'GET' && sessionId !== undefined) {
    sendJson(res, 200, availability(parts, req, sessionId));
    return;
  }
  const tokenId = authenticateControl(req, url, parts.credentials);
  const actions = parts.actions();
  if (!actions) throw new HttpError(503, 'Memory review unavailable');
  const response = await controlResponse(actions, req, url, tokenId);
  sendJson(res, response.status, response.value);
}
