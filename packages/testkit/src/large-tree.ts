import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Sizes of a synthetic, `cp`-without-`-p` shaped tree: every file is written now, in-record timestamps span `spanDays`. */
export interface LargeTreeOptions {
  ledgerRows: number;
  statusFiles: number;
  registryRows: number;
  questionFiles: number;
  /** Rows in `events.jsonl`; a rotated `events-*.jsonl` and the `turns*.jsonl` files repeat the shape. Default 2 000. */
  eventRows?: number;
  /** Rows older than this many days precede the window; default 40 (the in-record span). */
  spanDays?: number;
  now?: number;
  /** pi session JSONL files (v3) under `<root>/sessions`; default 0. */
  sessionFiles?: number;
  /** Approximate bytes per session file; default 256 KiB. */
  sessionBytes?: number;
}

export interface LargeTree { root: string; orchRoot: string; sessionRoot: string; spanDays: number; now: number }

const day = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const jsonl = (rows: Iterable<unknown>) => [...rows].map(row => JSON.stringify(row)).join('\n') + '\n';
const put = (file: string, content: string) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, content); };

/** Time of row `index` of `count`, oldest first, ending now. */
const at = (now: number, spanDays: number, index: number, count: number) => now - spanDays * day + Math.floor(((index + 1) / Math.max(1, count)) * spanDays * day) - 1;

function* contextRows(now: number, spanDays: number, count: number, every: number) {
  for (let i = 0; i < count; i++) {
    const time = iso(at(now, spanDays, i, count));
    yield i % every === 0
      ? { at: time, event: 'handoff_committed', sessionId: `s-${i % 50}`, path: `handoffs/h-${i}.md` }
      : { at: time, event: 'turn', sessionId: `s-${i % 50}`, tokens: 90_000, soft: 100_000, hard: 120_000 };
  }
}

function ledger(root: string, now: number, spanDays: number, rows: number): void {
  const byDay = new Map<string, unknown[]>();
  for (let i = 0; i < rows; i++) {
    const queued = at(now, spanDays, i, rows);
    const name = iso(queued).slice(0, 10);
    const row = { v: 1, argvHash: `h-${i}`, label: 'unit checks', queuedAt: iso(queued), startedAt: iso(queued + 1_000), endedAt: iso(queued + 9_000), outcome: 'passed', exit: 0, argv: 'x'.repeat(1_500) };
    const list = byDay.get(name) ?? [];
    list.push(row);
    byDay.set(name, list);
  }
  for (const [name, list] of byDay) put(join(root, 'pi-phase/state/ledger', `${name}.jsonl`), jsonl(list));
}

const filler = (n: number, size: number) => `Turn ${n}: `.padEnd(size, 'lorem ipsum dolor sit amet ');

/**
 * One request of a pi v3 session: a user turn, eight tool calls with their (mostly large) results and an answer, the
 * shape real sessions have; every third request also starts a pi-jobs job.
 */
function* sessionRound(id: string, n: number, time: number) {
  const base = { type: 'message', timestamp: iso(time) };
  yield { ...base, id: `${id}-u${n}`, message: { role: 'user', content: [{ type: 'text', text: filler(n, 400) }] } };
  for (let call = 0; call < 8; call++) {
    yield { ...base, id: `${id}-t${n}.${call}`, message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', name: 'bash', arguments: { command: filler(n, 300) } }] } };
    yield { ...base, id: `${id}-r${n}.${call}`, message: { role: 'toolResult', toolName: 'bash', content: [{ type: 'text', text: filler(n, 3_000) }] } };
  }
  if (n % 3 === 0) {
    const details = { id: `${id}-job${n}`, label: 'unit checks', status: 'succeeded', exitCode: 0, startedAt: time, endedAt: time + 5_000 };
    yield { ...base, id: `${id}-j${n}`, message: { role: 'toolResult', toolName: 'job_start', details, content: [{ type: 'text', text: 'started' }] } };
  }
  yield { ...base, id: `${id}-a${n}`, message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: filler(n, 300) }] } };
}

function sessionFile(id: string, time: number, bytes: number): string {
  const lines = [JSON.stringify({ type: 'session', version: 3, id, cwd: '/synthetic/workspaces/volume', timestamp: iso(time) })];
  let size = lines[0].length;
  for (let n = 0; size < bytes; n++) {
    for (const row of sessionRound(id, n, time + n * 1_000)) {
      const line = JSON.stringify(row);
      lines.push(line);
      size += line.length + 1;
    }
  }
  return lines.join('\n') + '\n';
}

function sessions(root: string, now: number, options: LargeTreeOptions): void {
  const count = options.sessionFiles ?? 0;
  for (let i = 0; i < count; i++) {
    const id = `volume-${String(i).padStart(5, '0')}`;
    put(join(root, `--synthetic-${i % 20}--`, `${id}.jsonl`), sessionFile(id, now - (count - i) * 60_000, options.sessionBytes ?? 256 * 1024));
  }
  mkdirSync(root, { recursive: true });
}

/** Writes the tree under `root` (agent root) and `root/orch`; the layout the daemon source table scans. */
export function buildLargeTree(root: string, options: LargeTreeOptions): LargeTree {
  const spanDays = options.spanDays ?? 40;
  const now = options.now ?? Date.now();
  const eventRows = options.eventRows ?? 2_000;
  const context = join(root, 'context-budget');
  put(join(context, 'events.jsonl'), jsonl(contextRows(now, spanDays, eventRows, 50)));
  put(join(context, 'events-20261001T000000Z.jsonl'), jsonl(contextRows(now - 60 * day, 20, Math.ceil(eventRows / 4), 50)));
  put(join(context, 'turns.jsonl'), jsonl(contextRows(now, spanDays, Math.ceil(eventRows / 2), 0)));
  for (let i = 0; i < options.statusFiles; i++) put(join(context, 'status', `s-${i}.json`), JSON.stringify({ at: iso(now), cursor: i }) + '\n');
  const registry = Array.from({ length: options.registryRows }, (_, i) => ({ repo: 'example/console', issue: i % 5_000, sessionId: 's-1', state: 'in-progress', ts: iso(at(now, spanDays, i, options.registryRows)) }));
  put(join(root, 'issue-work/registry.jsonl'), jsonl(registry));
  put(join(root, 'issue-work/registry.jsonl.bak-1'), jsonl(registry.slice(0, 10)));
  put(join(root, 'issue-work/seen/a.json'), '{"seen":true}\n');
  put(join(root, 'issue-work/locks/a.lock'), '{"pid":1}\n');
  ledger(root, now, spanDays, options.ledgerRows);
  for (let i = 0; i < options.questionFiles; i++) {
    const history = [{ seq: 1, type: 'created', ts: iso(now - i * 1_000) }];
    put(join(root, 'user-questions/items', `q-${i}`, 'r00000001.json'), JSON.stringify({ v: 1, id: `q-${i}`, rev: 1, type: 'decision', priority: 'normal', blocking: '', text: `Question ${i}?`, history }) + '\n');
  }
  mkdirSync(join(root, 'orch/inbox'), { recursive: true });
  mkdirSync(join(root, 'orch/heartbeats'), { recursive: true });
  const sessionRoot = join(root, 'sessions');
  sessions(sessionRoot, now, options);
  return { root, orchRoot: join(root, 'orch'), sessionRoot, spanDays, now };
}
