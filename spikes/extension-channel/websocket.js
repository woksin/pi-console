import { createHash } from 'node:crypto';
import { MAX_BYTES, safely } from './protocol.js';

export function frame(text) {
  const body = Buffer.from(text);
  if (body.length > MAX_BYTES) throw new Error('frame too large');
  const header = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
  return Buffer.concat([header, body]);
}

function unmask(pending, offset, size) {
  const mask = pending.subarray(offset, offset + 4);
  const body = Buffer.from(pending.subarray(offset + 4, offset + 4 + size));
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
  return new TextDecoder('utf-8', { fatal: true }).decode(body);
}

function frameHeader(pending) {
  if (pending.length < 2) return null;
  if (pending[0] !== 0x81 || !(pending[1] & 0x80)) throw new Error('unsupported frame');
  const shortSize = pending[1] & 127;
  if (shortSize === 127) throw new Error('oversized frame');
  const offset = shortSize === 126 ? 4 : 2;
  if (pending.length < offset) return null;
  return { offset, size: offset === 4 ? pending.readUInt16BE(2) : shortSize };
}

function parseFrame(pending) {
  const header = frameHeader(pending);
  if (!header) return null;
  const { offset, size } = header;
  if (size > MAX_BYTES) throw new Error('oversized frame');
  const consumed = offset + 4 + size;
  if (pending.length < consumed) return null;
  return { consumed, text: unmask(pending, offset, size) };
}

// Deliberately small RFC6455 subset: masked, final text only; reject fragmentation.
export function decoder(onText, reject) {
  let pending = Buffer.alloc(0);
  let failed = false;
  return chunk => {
    if (failed) return;
    try {
      if (pending.length + chunk.length > MAX_BYTES * 2) throw new Error('oversized buffer');
      pending = Buffer.concat([pending, chunk]);
      let parsed;
      while ((parsed = parseFrame(pending))) {
        pending = pending.subarray(parsed.consumed);
        onText(parsed.text);
      }
    } catch {
      failed = true;
      pending = Buffer.alloc(0);
      reject();
    }
  };
}

function validRequest(request, socket) {
  const h = request.headers;
  return [request.url === '/extension', !h.origin, h.host === `127.0.0.1:${socket.localPort}`,
    h.upgrade?.toLowerCase() === 'websocket', h['sec-websocket-version'] === '13',
    typeof h['sec-websocket-key'] === 'string', /^[A-Za-z0-9+/]{22}==$/.test(h['sec-websocket-key'])].every(Boolean);
}

export function upgrade(request, socket, head, onText) {
  const key = request.headers['sec-websocket-key'];
  if (!validRequest(request, socket)) { socket.destroy(); return null; }
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const receive = decoder(onText, () => socket.destroy());
  socket.on('data', safely(receive));
  socket.on('error', () => {});
  if (head.length) queueMicrotask(() => receive(head));
  return value => {
    if (socket.destroyed || socket.writableLength > MAX_BYTES * 2) return false;
    return socket.write(frame(JSON.stringify(value)));
  };
}
