/**
 * Samples derived requests from a COPY of real pi session files, for a by-hand check of the pairing rules
 * (docs/requests.md). Never point it at the live sessions directory and never commit its output.
 *
 *   node packages/core/tools/sample-requests.ts --source <copied-sessions-dir> --out .ai-work/p5/sample.md [--count 30] [--seed 1]
 *
 * It runs the real pipeline (session adapter with redaction, event log, projector) in a temporary directory.
 */
import { mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { sessionTailer } from '@pi-console/adapters';
import { Projector, SqliteEventLog, consoleProjections, readModels, type RequestModel } from '@pi-console/core';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const liveSessions = resolve(homedir(), '.pi/agent/sessions');

function within(path: string, directory: string): boolean {
  const rest = relative(directory, path);
  return rest === '' || (!rest.startsWith('..') && !rest.startsWith('/'));
}

function options() {
  const { values } = parseArgs({ options: { source: { type: 'string' }, out: { type: 'string' }, count: { type: 'string', default: '30' }, seed: { type: 'string', default: '1' } } });
  if (!values.source || !values.out) throw new Error('usage: --source <copied-sessions-dir> --out .ai-work/<file>.md [--count 30] [--seed 1]');
  const source = realpathSync(values.source);
  const out = resolve(values.out);
  if (within(source, liveSessions)) throw new Error('refusing the live sessions directory: copy the files first');
  if (!within(out, join(repositoryRoot, '.ai-work'))) throw new Error('output must be under .ai-work/ (never committed)');
  return { source, out, count: Number(values.count), seed: Number(values.seed) };
}

function sessionFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .map(name => join(directory, name))
    .filter(path => path.endsWith('.jsonl') && statSync(path).isFile())
    .sort();
}

/** Seeded Fisher-Yates, so a sample can be reproduced. */
function sample<Item>(items: readonly Item[], count: number, seed: number): Item[] {
  const copy = [...items];
  let state = seed >>> 0;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const other = state % (index + 1);
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy.slice(0, count);
}

const cell = (text: string, width = 100) => {
  const line = text.replace(/[\r\n|]+/g, ' ');
  return line.length > width ? `${line.slice(0, width - 1)}…` : line;
};

function row(request: RequestModel): string {
  const evidence = (request.evidence ?? []).map(item => item.kind).join(' ');
  const flags = [request.uncertainReason, request.answerPossiblyUnseen ? 'possibly-unseen' : null].filter(Boolean).join(', ');
  return `| ${request.sessionId.slice(0, 8)} | ${request.ref?.entryId ?? ''} | ${request.status} | ${request.origin} | ${flags} | ${evidence} | ${cell(request.text)} | ${cell(request.answer?.text ?? '')} | |`;
}

function summary(requests: readonly RequestModel[]): string[] {
  const tally = (key: (request: RequestModel) => string | null | undefined) => {
    const counts = new Map<string, number>();
    for (const request of requests) {
      const value = key(request) ?? 'none';
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts].sort().map(([name, count]) => `${name} ${String(count)}`).join(', ');
  };
  return [
    `- requests: ${String(requests.length)}`, `- status: ${tally(request => request.status)}`, `- origin: ${tally(request => request.origin)}`,
    `- uncertain: ${tally(request => request.uncertainReason)}`, `- possibly unseen: ${String(requests.filter(request => request.answerPossiblyUnseen).length)}`,
  ];
}

/** A poll reads one batch per file; keep polling until the file is consumed (or stops making progress). */
async function drain(file: string, log: SqliteEventLog): Promise<void> {
  const tailer = sessionTailer(log, file, { batchBytes: 8 * 1024 * 1024 });
  for (let result = await tailer.poll([file]); result.lagBytes > 0 && result.entries > 0;) result = await tailer.poll([file]);
}

async function main(): Promise<void> {
  const { source, out, count, seed } = options();
  const scratch = mkdtempSync(join(tmpdir(), 'pi-console-sample-'));
  try {
    const log = new SqliteEventLog(join(scratch, 'events.db'));
    const files = sessionFiles(source);
    for (const file of files) await drain(file, log);
    const projector = new Projector(log, consoleProjections());
    await projector.catchUp();
    const requests = Object.values(readModels(projector).requests.requests);
    log.close();
    const lines = [
      `# Request derivation sample (seed ${String(seed)}, ${String(files.length)} session files)`, '', ...summary(requests), '',
      '| session | entry | status | origin | flags | evidence | prompt | answer | verdict |', '|---|---|---|---|---|---|---|---|---|',
      ...sample(requests, count, seed).map(row), '',
    ];
    writeFileSync(out, lines.join('\n'), { mode: 0o600 });
    console.log(`wrote ${String(Math.min(count, requests.length))} of ${String(requests.length)} requests to ${out}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

await main();
