import { lstatSync, readFileSync, type Stats } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MemoryReviewClient, type ReviewBus } from './client.ts';

/** Structural subset of pi's public extension API. No pi or provider implementation dependency. */
interface Context { cwd: string; sessionManager: { getSessionId(): string | undefined } }
interface ExtensionApi {
  events: ReviewBus;
  on(name: 'session_start' | 'session_switch' | 'session_shutdown', listener: (event: unknown, context: Context) => void): void;
}
function localUrl(base: URL): boolean {
  return base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname);
}
function bareUrl(base: URL): boolean {
  return !base.username && !base.password && base.pathname === '/' && !base.search && !base.hash;
}
function channelUrl(): string {
  const base = new URL(process.env.PI_CONSOLE_URL ?? 'http://127.0.0.1:4777');
  if (!localUrl(base)) throw new Error('Loopback required');
  if (!bareUrl(base)) throw new Error('Base URL required');
  base.protocol = 'ws:';
  base.pathname = '/api/v1/extensions/memory-review';
  return base.href;
}
function credentialPath(): string {
  return join(process.env.PI_CONSOLE_DATA_DIR ?? join(homedir(), '.pi-console'), 'memory-control-token');
}
function privateFile(stat: Stats): boolean {
  return stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0;
}
function credential(): string {
  const path = credentialPath();
  const stat = lstatSync(path);
  if (!privateFile(stat)) throw new Error('Private credential required');
  if (process.getuid && stat.uid !== process.getuid()) throw new Error('Credential owner mismatch');
  const secret = readFileSync(path, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/u.test(secret)) throw new Error('Invalid credential');
  return secret;
}
function missingCredential(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (!('code' in error)) return false;
  return error.code === 'ENOENT';
}
export default function memoryReviewExtension(pi: ExtensionApi): void {
  let client: MemoryReviewClient | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    clearTimeout(retry);
    retry = undefined;
    client?.close();
    client = undefined;
  };
  const connect = (sessionId: string, cwd: string, delay = 1000): void => {
    retry = undefined;
    try {
      client = new MemoryReviewClient({ url: channelUrl(), secret: credential(), binding: { sessionId, pid: process.pid, cwd }, bus: pi.events });
    } catch (error) {
      // Only absent credentials are retried; incompatible installations remain read-only. Never log secrets.
      if (!missingCredential(error)) return;
      retry = setTimeout(() => { connect(sessionId, cwd, Math.min(delay * 2, 30_000)); }, delay);
      retry.unref();
    }
  };
  const start = (_event: unknown, context: Context) => {
    stop();
    if (process.env.PI_CONSOLE_MEMORY_REVIEW !== '1') return;
    try {
      const sessionId = context.sessionManager.getSessionId();
      if (sessionId) connect(sessionId, context.cwd);
    } catch { /* Missing or incompatible installations remain read-only. No credential/source logging. */ }
  };
  pi.on('session_start', start);
  pi.on('session_switch', start);
  pi.on('session_shutdown', stop);
}
