/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are untyped JSON that specs validate against the schema */
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';

export interface Reply { status: number; headers: IncomingHttpHeaders; body: any; text: string }
export interface RequestOptions { method?: string; headers?: Record<string, string>; body?: string }

/** Raw HTTP so specs control Host, Origin and Sec-Fetch-Site exactly (fetch forbids setting some of them). */
export function call(port: number, path: string, options: RequestOptions = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: { Host: `127.0.0.1:${port}`, ...options.headers } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body: unknown;
        try { body = JSON.parse(text); } catch { body = undefined; }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, text });
      });
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

export interface Frame { id: string | undefined; event: string | undefined; data: any }

export interface Stream {
  status: number;
  headers: IncomingHttpHeaders;
  /** The next event frame (comments such as heartbeats are skipped). Rejects after `timeoutMs`. */
  next(timeoutMs?: number): Promise<Frame>;
  close(): void;
}

function parseFrame(block: string): Frame | undefined {
  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    if (line.startsWith(':') || !line.includes(':')) continue;
    const index = line.indexOf(':');
    fields[line.slice(0, index)] = line.slice(index + 1).replace(/^ /, '');
  }
  if (fields.data === undefined) return undefined;
  return { id: fields.id, event: fields.event, data: JSON.parse(fields.data) };
}

/** Opens `/api/v1/stream`; resolves once response headers arrive (non-200 replies carry their JSON error body). */
export function openStream(port: number, headers: Record<string, string>): Promise<Stream & { body?: any }> {
  return new Promise((resolve, reject) => {
    const frames: Frame[] = [];
    const waiters: ((frame: Frame) => void)[] = [];
    let buffer = '';
    const req = httpRequest({ host: '127.0.0.1', port, path: '/api/v1/stream', headers: { Host: `127.0.0.1:${port}`, ...headers } }, res => {
      res.setEncoding('utf8');
      const stream: Stream = {
        status: res.statusCode ?? 0, headers: res.headers,
        next(timeoutMs = 5000) {
          const ready = frames.shift();
          if (ready) return Promise.resolve(ready);
          return new Promise((done, fail) => {
            const timer = setTimeout(() => fail(new Error('No SSE frame within timeout')), timeoutMs);
            waiters.push(frame => { clearTimeout(timer); done(frame); });
          });
        },
        close() { req.destroy(); },
      };
      if (res.statusCode !== 200) {
        let text = '';
        res.on('data', (chunk: string) => { text += chunk; });
        res.on('end', () => resolve({ ...stream, body: JSON.parse(text) }));
        return;
      }
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = parseFrame(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
          if (!frame) continue;
          const waiter = waiters.shift();
          if (waiter) waiter(frame); else frames.push(frame);
        }
      });
      res.on('error', () => undefined);
      resolve(stream);
    });
    req.on('error', reject);
    req.end();
  });
}
