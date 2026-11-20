import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { authenticate, safely } from './protocol.js';
import { upgrade } from './websocket.js';

const EVENTS = new Set(['session_start', 'agent_start', 'agent_end', 'agent_before_settle', 'agent_settled', 'turn_start', 'turn_end', 'message_end', 'session_shutdown']);

function publicEvent(event) {
  if (event?.type === 'receipt') return true;
  return event?.type === 'event' && EVENTS.has(event.name);
}

function rateLimit() {
  let count = 0;
  let windowStart = Date.now();
  return () => {
    if (Date.now() - windowStart >= 1000) { count = 0; windowStart = Date.now(); }
    return ++count <= 100;
  };
}

// Only the PID/cwd of the child started by scratch.js may register, once.
export async function startStub(token, expected, onEvent) {
  const sockets = new Set();
  let pinned;
  let send;
  const server = createServer((_req, res) => { res.writeHead(404).end(); });
  server.on('upgrade', (request, socket, head) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const nonce = randomBytes(32).toString('hex');
    let authenticated = false;
    const withinRate = rateLimit();
    const deadline = setTimeout(() => socket.destroy(), 3000);
    socket.on('close', () => clearTimeout(deadline));
    function acceptHello(event) {
      if (pinned || !authenticate(event, token, nonce, expected)) {
        onEvent({ type: 'rejected', reason: 'authentication' });
        socket.destroy();
        return;
      }
      pinned = { sessionId: event.sessionId, pid: event.pid };
      authenticated = true;
      clearTimeout(deadline);
      send = output;
      const { mac: _mac, ...hello } = event;
      onEvent(hello); // Never log token, nonce or MAC.
    }
    function receive(text) {
      if (!withinRate()) { socket.destroy(); return; }
      let event;
      try { event = JSON.parse(text); } catch { socket.destroy(); return; }
      if (!authenticated) { acceptHello(event); return; }
      if (publicEvent(event)) onEvent(event);
    }
    const output = upgrade(request, socket, head, safely(receive));
    output?.({ type: 'challenge', nonce });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `ws://127.0.0.1:${server.address().port}/extension`,
    send(command) {
      if (!send) throw new Error('scratch session not authenticated');
      return send(command);
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
