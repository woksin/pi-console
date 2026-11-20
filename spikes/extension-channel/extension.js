import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { commandHandler, MAX_BYTES, outbox, safely, sign } from './protocol.js';

const EVENTS = ['agent_start', 'agent_end', 'agent_before_settle', 'agent_settled', 'turn_start', 'turn_end', 'message_end'];

function permittedContext(ctx) {
  return [Boolean(ctx.hasUI), process.env.PI_CONSOLE_OPTOUT !== '1', !process.env.PI_ORCH_ID].every(Boolean);
}

function scratchConfig(ctx) {
  const cwd = realpathSync(ctx.cwd);
  if (!permittedContext(ctx)) return null;
  if (process.env.PI_CONSOLE_SCRATCH_CWD !== cwd || !cwd.includes('/.ai-work/')) return null;
  const tokenPath = join(cwd, 'token');
  const stat = statSync(tokenPath);
  if (![stat.isFile(), (stat.mode & 0o777) === 0o600, stat.uid === process.getuid()].every(Boolean)) return null;
  const url = new URL(process.env.PI_CONSOLE_SCRATCH_URL);
  if (![url.protocol === 'ws:', url.hostname === '127.0.0.1', url.pathname === '/extension'].every(Boolean)) return null;
  return { token: readFileSync(tokenPath, 'utf8'), url: url.href };
}

// Only fixture text leaves the process. This is NOT a general-purpose secret scanner.
function excerpt(message) {
  const text = typeof message?.content === 'string' ? message.content
    : message?.content?.filter(c => c.type === 'text').map(c => c.text).join(' ');
  if (/^(?:\[console:spike\] )?(?:scratch hello|steer marker|follow marker|passive marker|drain marker|fixture reply)$/.test(text)) return text;
  return '[withheld]';
}

function delivery(pi) {
  return (command, text) => {
    if (command.type === 'next_turn') {
      pi.sendMessage({ customType: 'console-spike', content: text, display: true }, { deliverAs: 'nextTurn' });
    } else {
      pi.sendUserMessage(text, { deliverAs: command.mode, expandPromptTemplates: false });
    }
  };
}

function receiveMessage(state, config, event) {
  if (typeof event.data !== 'string' || Buffer.byteLength(event.data) > MAX_BYTES) return;
  const data = JSON.parse(event.data);
  if (state.challenged) { state.queue.push({ type: 'receipt', ...state.handle(data) }); return; }
  if (data.type !== 'challenge' || !/^[a-f0-9]{64}$/.test(data.nonce)) return;
  state.challenged = true;
  const sessionId = state.ctx.sessionManager.getSessionId();
  state.queue.push({ type: 'hello', sessionId, pid: process.pid, cwd: state.ctx.cwd,
    hasUI: state.ctx.hasUI, model: state.ctx.model?.id, mode: 'rpc', lane: null,
    mac: sign(config.token, sessionId, data.nonce) });
  emit(state, 'session_start', {});
}

function emit(state, name, event) {
  state.queue?.push({ type: 'event', name,
    ...(name === 'message_end' ? { role: event.message?.role, text: excerpt(event.message) } : {}),
  });
}

function connect(state, config) {
  state.socket = new WebSocket(config.url);
  state.queue = outbox(state.socket);
  state.timer = setInterval(safely(() => state.queue.flush()), 50);
  state.socket.addEventListener('error', () => {});
  state.socket.addEventListener('close', () => clearInterval(state.timer));
  state.socket.addEventListener('message', safely(event => receiveMessage(state, config, event)));
}

export default function extension(pi) {
  const state = {};
  state.handle = commandHandler(delivery(pi), () => permittedContext(state.ctx));
  pi.on('session_start', safely((_event, context) => {
    state.ctx = context;
    const config = scratchConfig(context);
    if (config) connect(state, config);
  }));
  for (const name of EVENTS) pi.on(name, safely((event, context) => { state.ctx = context; emit(state, name, event); }));
  pi.on('session_shutdown', safely(() => {
    emit(state, 'session_shutdown', {});
    state.queue?.flush();
    clearInterval(state.timer);
    state.socket?.close();
  }));
}
