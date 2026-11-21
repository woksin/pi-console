import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../http/output.ts';
import { authenticateControl, HttpError } from '../security/guard.ts';
import type { Credentials } from '../security/token.ts';
import { memoryActionsPath, type MemoryActions } from './actions.ts';

interface Parts { credentials: Credentials; actions(): MemoryActions | undefined }
export function isMemoryApiPath(url: URL): boolean {
  return url.pathname === memoryActionsPath || url.pathname.startsWith(`${memoryActionsPath}/`);
}
function availabilityRequest(req: IncomingMessage, url: URL): boolean {
  return req.method === 'GET' && url.pathname === `${memoryActionsPath}/availability`;
}
function receiptId(url: URL): string {
  const id = url.pathname.slice(memoryActionsPath.length + 1);
  if (!id || id.includes('/')) throw new HttpError(405, 'Method not allowed');
  return id;
}
async function controlResponse(actions: MemoryActions, req: IncomingMessage, url: URL, tokenId: string): Promise<{ status: number; value: unknown }> {
  if (req.method === 'POST' && url.pathname === memoryActionsPath) return { status: 202, value: await actions.post(req, tokenId) };
  if (req.method === 'GET') return { status: 200, value: actions.receipt(receiptId(url), tokenId) };
  throw new HttpError(405, 'Method not allowed');
}
/** Called only after normal read authentication and Host/Origin validation. */
export async function memoryApi(parts: Parts, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const actions = parts.actions();
  if (availabilityRequest(req, url)) {
    sendJson(res, 200, actions?.availability() ?? { version: 1, available: false, generation: null, reason: 'disabled' });
    return;
  }
  const tokenId = authenticateControl(req, url, parts.credentials);
  if (!actions) throw new HttpError(409, 'Memory review unavailable');
  const response = await controlResponse(actions, req, url, tokenId);
  sendJson(res, response.status, response.value);
}
