import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { startStub } from './stub.js';

const source = dirname(fileURLToPath(import.meta.url));
const root = realpathSync(resolve(source, '../..'));
const output = join(root, '.ai-work/tasks/m0-extension/output');
mkdirSync(output, { recursive: true, mode: 0o700 });
const cwd = mkdtempSync(join(output, 'scratch-'));
const piDir = process.env.PI_CONSOLE_PI_DIR || join(homedir(), '.local/share/pi-runtime/lib/node_modules/@earendil-works/pi-coding-agent');
const token = randomBytes(32).toString('hex');
writeFileSync(join(cwd, 'token'), token, { mode: 0o600 });
mkdirSync(join(cwd, 'agent'), { mode: 0o700 });
const events = [];
const rpc = [];
const expected = { cwd, pid: null };
const stub = await startStub(token, expected, event => {
  events.push(event);
  appendFileSync(join(cwd, 'events.jsonl'), JSON.stringify(event) + '\n', { mode: 0o600 });
});
const child = spawn(process.execPath, [join(piDir, 'dist/bundle/cli.js'),
  '--mode', 'rpc', '--no-session', '--no-tools', '--no-extensions', '--no-mcp',
  '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-approve', '--offline',
  '-e', join(source, 'extension.js'), '-e', join(source, 'scratch-provider.js'),
  '--provider', 'console-fixture', '--model', 'fixture', '--thinking', 'off'], {
  cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
  env: { PATH: process.env.PATH, HOME: homedir(), TMPDIR: process.env.TMPDIR,
    PI_CODING_AGENT_DIR: join(cwd, 'agent'), PI_OFFLINE: '1', PI_TELEMETRY: '0',
    PI_CONSOLE_SCRATCH_CWD: cwd, PI_CONSOLE_SCRATCH_URL: stub.url, PI_CONSOLE_PI_DIR: piDir },
});
expected.pid = child.pid;
let failure;
child.on('error', error => { failure = error; });
child.on('exit', (code, signal) => { failure = new Error(`scratch pi exited: ${code}/${signal}`); });
child.stdin.on('error', error => { failure = error; });
createInterface({ input: child.stdout }).on('line', line => {
  appendFileSync(join(cwd, 'rpc.jsonl'), line + '\n', { mode: 0o600 });
  try { rpc.push(JSON.parse(line)); } catch { /* Startup diagnostics are not RPC. */ }
});
child.stderr.on('data', data => appendFileSync(join(cwd, 'stderr.log'), data, { mode: 0o600 }));
const deadline = Date.now() + 45000;
async function until(predicate) {
  while (!predicate()) {
    if (failure) throw failure;
    if (Date.now() > deadline) throw new Error(`scratch deadline; inspect ${cwd}`);
    await delay(25);
  }
}
const request = value => child.stdin.write(JSON.stringify(value) + '\n');
const command = (id, type, text, mode) => ({ id, type, text, mode, issuer: 'spike', timestamp: Date.now(), ttl: 10000 });
const receipt = id => events.find(e => e.type === 'receipt' && e.id === id);
const settled = () => events.filter(e => e.name === 'agent_settled').length;

async function messages(id) {
  request({ type: 'get_messages', id });
  await until(() => rpc.some(e => e.type === 'response' && e.id === id));
  const response = rpc.find(e => e.type === 'response' && e.id === id);
  assert.equal(response.success, true);
  return response.data.messages;
}

async function probeQuestions() {
  const packageDir = process.env.PI_QUESTIONS_PACKAGE || join(homedir(), '.pi/agent/local-packages/pi-questions');
  const { InputRing } = await import(pathToFileURL(join(packageDir, 'src/verbatim.ts')).href);
  const { resolveHome } = await import(pathToFileURL(join(packageDir, 'src/store.ts')).href);
  assert.equal(resolveHome({ PI_QUESTIONS_HOME: join(cwd, 'questions') }), join(cwd, 'questions'));
  const ring = new InputRing();
  ring.push('[console:spike] approved', 'extension');
  ring.push('approved', 'rpc');
  assert.equal(ring.match('approved'), null);
  ring.push('approved   by me', 'interactive');
  assert.equal(ring.match('approved by me'), 'approved   by me');
  assert.equal(ring.match('Approved'), null);
  console.log('questions: extension/rpc ignored; interactive whitespace-normalised, case-sensitive substring accepted (no store writes)');
}

try {
  await until(() => events.some(e => e.type === 'hello'));
  const hello = events.find(e => e.type === 'hello');
  assert.equal(hello.hasUI, true);
  console.log(`hello: scratch pid=${hello.pid}, hasUI=${hello.hasUI}, model=${hello.model}`);
  request({ type: 'prompt', message: 'scratch hello', id: 'initial' });
  await until(() => events.some(e => e.name === 'turn_start'));
  const steer = command('steer', 'interject', 'steer marker', 'steer');
  stub.send(steer);
  stub.send(steer);
  stub.send(command('follow', 'interject', 'follow marker', 'followUp'));
  stub.send(command('unknown', 'execute', 'steer marker'));
  stub.send({ ...command('expired', 'interject', 'steer marker', 'steer'), timestamp: Date.now() - 20000 });
  await until(() => receipt('follow') && receipt('expired') && events.some(e => e.duplicate));
  assert.equal(receipt('steer').outcome, 'accepted');
  assert.equal(receipt('follow').outcome, 'accepted');
  assert.equal(receipt('unknown').outcome, 'unknown_type');
  assert.equal(receipt('expired').outcome, 'expired');
  await until(() => settled() >= 1);
  const first = await messages('first');
  const text = JSON.stringify(first);
  assert.equal(first.filter(m => JSON.stringify(m.content).includes('[console:spike] steer marker')).length, 1);
  assert.ok(text.includes('[console:spike] follow marker'));
  console.log('interject: steer + followUp present in RPC transcript; steer redelivery occurs exactly once');
  const before = settled();
  stub.send(command('passive', 'next_turn', 'passive marker'));
  await until(() => receipt('passive'));
  assert.equal(receipt('passive').outcome, 'accepted');
  await delay(250);
  assert.equal(settled(), before);
  assert.ok(!JSON.stringify(await messages('passive-check')).includes('passive marker'));
  request({ type: 'prompt', message: 'drain marker', id: 'drain' });
  await until(() => settled() > before);
  const final = await messages('final');
  assert.ok(final.some(m => m.customType === 'console-spike' && m.content === '[console:spike] passive marker'));
  assert.ok(events.some(e => e.name === 'agent_before_settle'));
  console.log('nextTurn: passive until next prompt, then custom message observed; agent_before_settle fired');
  await probeQuestions();
  console.log(`evidence: ${cwd}`);
} finally {
  try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  await stub.close();
}
