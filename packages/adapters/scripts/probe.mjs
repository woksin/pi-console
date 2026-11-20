// Read-only source probe: only aggregate output under the current worktree's .ai-work.
import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { mapLine } from '../src/tailing/events.ts';
import { sourceFile, pathDenied } from '../src/tailing/paths.ts';
import { sessionMapper } from '../src/session/mapper.ts';
import { contextMapper, laneMapper, rosterMapper, orchMapper, questionMapper, issueMapper, phaseMapper } from '../src/index.ts';

const home = homedir();
const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
const definitions = [
  ['S1', '.pi/agent/sessions', 'session-jsonl', null, '.jsonl'],
  ['S2', '.pi/agent/context-budget', 'context-budget', contextMapper, '.jsonl', '.json'],
  ['S4', '.pi/agent/lane-status', 'lane-messages', rosterMapper, '.json'],
  ['S4-registry', '.pi/lanes', 'lane-messages', laneMapper, '.json'],
  ['S5-messages', '.pi/orch/inbox', 'lane-messages', orchMapper, '.json'],
  ['S5-heartbeats', '.pi/orch/heartbeats', 'lane-heartbeats', orchMapper, '.json'],
  ['S5-receipts', '.pi/orch/receipts', 'lane-messages', orchMapper, '.json'],
  ['S8', '.pi/agent/user-questions/items', 'question-store', questionMapper, '.json'],
  ['S9', '.pi/agent/issue-work', 'issue-work', issueMapper, '.jsonl'],
  ['S10', '.pi/agent/jobs', 'job-logs', null, '.log'],
  ['S11', '.pi/agent/pi-phase/state/ledger', 'phase-ledger', phaseMapper, '.jsonl'],
  ['S13', '.pi/agent/logs', 'review-logs', null, '.log'],
];

function directoryEntries(directory) {
  try { return readdirSync(directory, { withFileTypes: true }); } catch { return []; }
}

function eligible(entry, path, extensions, reviewsOnly) {
  if (!entry.isFile()) return false;
  if (!extensions.some(extension => path.endsWith(extension))) return false;
  if (reviewsOnly && !entry.name.includes('review')) return false;
  return lstatSync(path).mtimeMs >= since;
}

function files(root, extensions, reviewsOnly) {
  const result = [];
  for (const entry of directoryEntries(root)) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink() || pathDenied(path)) continue;
    if (entry.isDirectory()) result.push(...files(path, extensions, reviewsOnly));
    else if (eligible(entry, path, extensions, reviewsOnly)) result.push(path);
  }
  return result;
}

function mapperForHeader(line) {
  const header = JSON.parse(line);
  if (header.type !== 'session') throw new Error('Unsupported');
  if (header.version !== 3) throw new Error('Unsupported');
  if (typeof header.id !== 'string') throw new Error('Unsupported');
  return sessionMapper(header.id);
}

function inspect(path, root, definition, result) {
  const { source } = definition;
  let { mapper } = definition;
  let body;
  try { body = readFileSync(sourceFile(path, [root]), 'utf8'); } catch { result.unreadable++; return; }
  const lines = path.endsWith('.jsonl') ? body.split('\n').slice(0, -1).filter(line => line.trim()) : [body];
  if (source === 'session-jsonl') {
    try {
      mapper = mapperForHeader(lines[0]);
    } catch { result.records += lines.length; result.unknown += lines.length; return; }
  }
  const checkpoint = { source, path, identity: 'probe', generation: 0, offset: 0, size: 0, mtimeMs: 0, headHash: '' };
  for (const line of lines) {
    result.records++;
    const events = mapLine(line, 0, { mapper, checkpoint });
    const warnings = events.filter(event => event.type === 'SourceSchemaUnknown').length;
    result.facts += events.length - warnings;
    result.unknown += Number(warnings > 0);
    result.ignored += Number(events.length === 0);
  }
}

function probe([id, relative, source, mapper, ...extensions]) {
  const root = join(home, relative);
  const paths = files(root, extensions, id === 'S13');
  const result = { source: id, files: paths.length, records: 0, facts: 0, ignored: 0, unknown: 0, unreadable: 0 };
  if (id !== 'S10' && id !== 'S13') for (const path of paths) inspect(path, root, { source, mapper }, result);
  return { ...result, unknownRate: result.records ? result.unknown / result.records : 0 };
}

const results = definitions.map(probe);
const total = results.reduce((sum, row) => ({ files: sum.files + row.files, records: sum.records + row.records, facts: sum.facts + row.facts, unknown: sum.unknown + row.unknown }), { files: 0, records: 0, facts: 0, unknown: 0 });
const report = {
  window: 'last seven days by file mtime; complete JSONL records; no real content in output',
  generatedAt: new Date().toISOString(),
  note: 'S4 registry root is optional; S10/S13 raw logs counted, never opened. Missing roots are zero. Unknown includes unrepresentable contract values. Read-only source access; no source writes.',
  results, total: { ...total, unknownRate: total.records ? total.unknown / total.records : 0 },
};
const output = resolve(process.cwd(), '.ai-work/p2/probe.txt');
mkdirSync(resolve(process.cwd(), '.ai-work/p2'), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
