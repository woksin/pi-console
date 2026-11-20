import { resolve } from 'node:path';
import { createStaticServer } from './static-server.ts';

/** `node serve.ts [--port 4780] [--daemon 127.0.0.1:4777]`: serves packages/web/dist and proxies /api to the daemon. */
const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const [host, port] = option('--daemon', '127.0.0.1:4777').split(':');
const listen = Number(option('--port', '4780'));
const server = createStaticServer({ root: resolve(import.meta.dirname, '../../dist'), daemon: { host, port: Number(port) } });
server.listen(listen, '127.0.0.1', () => { console.log(`pi console web on http://127.0.0.1:${String(listen)} (daemon ${host}:${port})`); });
