import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_BYTES = 8192;
export const MAX_RECEIPTS = 256;
export const sign = (token, sessionId, nonce) =>
  createHmac('sha256', token).update(JSON.stringify([sessionId, nonce])).digest('hex');

const stringMatches = (value, pattern) => typeof value === 'string' && pattern.test(value);
const boundedText = (value, max) => typeof value === 'string' && value.length <= max;
const every = values => values.every(Boolean);

export function authenticate(hello, token, nonce, expected) {
  if (hello?.type !== 'hello') return false;
  if (!every([hello.pid === expected.pid, hello.cwd === expected.cwd,
    boundedText(hello.sessionId, 100), stringMatches(hello.mac, /^[a-f0-9]{64}$/)])) return false;
  return timingSafeEqual(Buffer.from(hello.mac, 'hex'), Buffer.from(sign(token, hello.sessionId, nonce), 'hex'));
}

function validTiming(c) {
  return every([Number.isSafeInteger(c.timestamp), Number.isSafeInteger(c.ttl), c.ttl >= 1, c.ttl <= 60000]);
}

function validIdentity(c) {
  return every([stringMatches(c.id, /^[\w-]{1,80}$/), stringMatches(c.issuer, /^[\w-]{1,40}$/), validTiming(c)]);
}

function validEnvelope(c, now) {
  if (!c || typeof c !== 'object') return 'invalid';
  if (!validIdentity(c)) return 'invalid';
  if (c.timestamp > now || c.timestamp + c.ttl <= now) return 'expired';
  if (!boundedText(c.text, 1024)) return 'invalid';
  if (c.type === 'next_turn') return null;
  return validInterject(c) ? null : 'unknown_type';
}

function validInterject(c) {
  return c.type === 'interject' && ['steer', 'followUp'].includes(c.mode);
}

// Claims are never evicted: reject when full, rather than re-executing an old id.
export function commandHandler(deliver, allowed = () => true) {
  const receipts = new Map();
  return (command, now = Date.now()) => {
    try {
      const rejection = validEnvelope(command, now);
      if (rejection) return { id: command?.id, outcome: rejection };
      if (receipts.has(command.id)) return { ...receipts.get(command.id), duplicate: true };
      if (receipts.size >= MAX_RECEIPTS) return { id: command.id, outcome: 'capacity' };
      if (!allowed()) return { id: command.id, outcome: 'unsafe_session' };
      const receipt = { id: command.id, outcome: 'claimed' };
      receipts.set(command.id, receipt);
      try {
        deliver(command, `[console:${command.issuer}] ${command.text}`);
        receipt.outcome = 'accepted'; // API accepted, not proof the model consumed it.
      } catch {
        receipt.outcome = 'delivery_failed';
      }
      return { ...receipt };
    } catch {
      return { outcome: 'invalid' };
    }
  };
}

export function safely(fn) {
  return (...args) => {
    try {
      Promise.resolve(fn(...args)).catch(() => {});
    } catch { /* Never propagate an extension callback failure into pi. */ }
  };
}

// One bounded FIFO, drained at 20Hz; no wait or retry inside a pi handler.
export function outbox(socket, limit = 32) {
  const queue = [];
  let dropped = 0;
  return {
    push(value) {
      try {
        const text = JSON.stringify(value);
        if (Buffer.byteLength(text) > MAX_BYTES || queue.length >= limit) { dropped++; return false; }
        queue.push(text);
        return true;
      } catch { dropped++; return false; }
    },
    flush() {
      const batch = queue.splice(0, 4);
      for (const text of batch) {
        try {
          if (socket.readyState !== 1 || socket.bufferedAmount > MAX_BYTES * 2) { dropped++; continue; }
          socket.send(text);
        } catch { dropped++; }
      }
    },
    get size() { return queue.length; },
    get dropped() { return dropped; },
  };
}
