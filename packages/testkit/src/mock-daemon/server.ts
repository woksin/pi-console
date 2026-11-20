import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { authenticate, HttpError, loadToken } from './security.ts';
import { createStore, type Store } from './store.ts';
import { intervene, query, type MockInfo } from './routes.ts';

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
function sendError(res: ServerResponse, error: unknown) {
  const status = error instanceof HttpError ? error.status : 500;
  const message = status === 500 ? 'Internal error' : (error as Error).message;
  json(res, status, { error: message });
}
interface Mock { store: Store; info: MockInfo }
async function route({ store, info }: Mock, req: IncomingMessage, res: ServerResponse, url: URL) {
  if (req.method === 'GET' && url.pathname === '/api/v1/stream') {
    store.connect(res, req.headers['last-event-id'] as string | undefined); // Node keeps a single value for this header
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/v1/interventions') {
    json(res, 202, await intervene(store, req));
    return;
  }
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
  json(res, 200, query(store, url, info));
}
function handler(store: Store, token: string, info: MockInfo) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const port = req.socket.localPort ?? 0;
      if (!authenticate(req, res, url, { port, token })) return;
      await route({ store, info }, req, res, url);
    } catch (error) { sendError(res, error); }
  };
}
export async function startDaemon(options: { port?: number; speed?: number; rate?: number; dataDirectory?: string; replayWindow?: number } = {}) {
  const token = loadToken(options.dataDirectory ?? resolve('.pi-console-dev'));
  const info: MockInfo = { port: 0, startedAt: new Date().toISOString(), replayWindow: options.replayWindow ?? 10000 };
  const store = createStore(options.speed ?? 1, options.rate, info.replayWindow);
  const server = createServer(handler(store, token, info));
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.on('close', () => store.close());
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 4777, '127.0.0.1', () => { server.removeListener('error', reject); resolveListen(); });
    });
  } catch (error) { store.close(); throw error; }
  const address = server.address() as { port: number; address: string };
  info.port = address.port;
  return {
    server, store, token, port: address.port, address: address.address,
    async close() {
      store.close();
      await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    },
  };
}
function parseOptions(args: string[]) {
  const options: { port?: number; speed?: number; rate?: number } = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    const value = Number(args[i + 1]);
    validateOption(name, value);
    options[name.slice(2) as keyof typeof options] = value;
  }
  return options;
}
const positiveNumber = (value: number): boolean => Number.isFinite(value) && value > 0;
function validateOption(name: string, value: number) {
  const usage = 'Usage: server.ts [--port 4777] [--speed 1] [--rate N]';
  const known = ['--port', '--speed', '--rate'].includes(name);
  if (!known || !positiveNumber(value)) throw new Error(usage);
  if (name === '--port') validateIntegerOption(value, 65535, 'Invalid port');
  if (name === '--rate') validateIntegerOption(value, Number.MAX_VALUE, 'Invalid rate');
}
function validateIntegerOption(value: number, maximum: number, message: string) {
  if (!Number.isInteger(value)) throw new Error(message);
  if (value > maximum) throw new Error(message);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const daemon = await startDaemon(parseOptions(process.argv.slice(2)));
  console.log(`Mock daemon listening on http://127.0.0.1:${daemon.port}; token: .pi-console-dev/token`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void daemon.close(); });
}
