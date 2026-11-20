import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { secretShapes } from './secret-shapes.ts';

/**
 * Builds a synthetic `~/.pi/agent`-like tree for adapter and daemon specs. Layout and entry shapes are the
 * record shapes the P2 mappers accept (adapters/src/fixtures/sources.json is the reference) in the on-disk layout
 * the daemon scans: see daemon ingestion/source-table.ts. Deterministic: no clock, no randomness.
 */
export interface AgentTreeOptions {
  /** Leave the last line of every session file unterminated (a write in progress). */
  tornLastLine?: boolean;
  /** Embed every secret shape in one user message and one question, to prove redaction end to end. */
  includeSecrets?: boolean;
}

export interface AgentTree {
  root: string;
  /** Orch directory (heartbeats, inbox); a sibling of the agent directory in real installs, nested here for cleanup. */
  orchRoot: string;
  sessions: { id: string; file: string }[];
  files: string[];
}

const baseTime = Date.parse('2026-11-20T09:00:00Z');
const at = (seconds: number) => new Date(baseTime + seconds * 1000).toISOString();
const jsonl = (rows: unknown[]) => rows.map(row => JSON.stringify(row)).join('\n') + '\n';

function write(tree: AgentTree, relative: string, content: string) {
  const file = join(tree.root, relative);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  tree.files.push(file);
  return file;
}

function sessionRows(id: string, secretText: string | null) {
  const message = (n: number, role: string, text: string) => ({ type: 'message', id: `${id}-m${n}`, timestamp: at(n * 10), message: { role, content: [{ type: 'text', text }] } });
  return [
    { type: 'session', id, cwd: '/synthetic/workspaces/aurora', timestamp: at(0) },
    { type: 'model_change', id: `${id}-model`, timestamp: at(1), model: 'synthetic-reasoner' },
    message(1, 'user', secretText ?? 'Compare the queue strategies and explain the trade-offs.'),
    message(2, 'assistant', 'A bounded queue keeps the retry budget predictable.'),
    { type: 'message', id: `${id}-m3`, timestamp: at(30), message: { role: 'toolResult', toolName: 'read', content: [{ type: 'text', text: 'export const retryLimit = 3;' }] } },
    { type: 'compaction', id: `${id}-c1`, timestamp: at(40), summary: 'Synthetic compaction.' },
    message(5, 'user', 'Check whether the retry policy handles partial results.'),
  ];
}

function addSessions(tree: AgentTree, options: AgentTreeOptions) {
  const secretText = options.includeSecrets ? secretShapes.map(secret => secret.value).join('\n') : null;
  for (const [index, id] of ['session-a', 'session-b'].entries()) {
    const text = jsonl(sessionRows(id, index === 0 ? secretText : null));
    const content = options.tornLastLine ? text.slice(0, text.length - 12) : text;
    const file = write(tree, `sessions/--synthetic-workspaces-aurora--/2026-11-20T09-00-0${index}_${id}.jsonl`, content);
    tree.sessions.push({ id, file });
  }
}

function addContextBudget(tree: AgentTree) {
  write(tree, 'context-budget/status/session-a.json', JSON.stringify({ sessionId: 'session-a', phase: 'working', updatedAt: at(50) }) + '\n');
  write(tree, 'context-budget/events.jsonl', jsonl([
    { at: at(20), event: 'turn', sessionId: 'session-a', tokens: 90000, soft: 100000, hard: 120000 },
    { at: at(45), event: 'handoff_committed', sessionId: 'session-a', path: 'handoffs/session-a.md' },
  ]));
  write(tree, 'context-budget/turns.jsonl', jsonl([{ at: at(11), event: 'turn', sessionId: 'session-a', tokens: 90000, soft: 100000, hard: 120000 }]));
  write(tree, 'context-budget/handoffs/session-a.md', '# Handoff\n\nCarried requests: none.\n');
}

/** Lane registry under the agent root; orch heartbeats and messages under the separate orch root. */
function addLanes(tree: AgentTree) {
  write(tree, 'lanes/registry.json', JSON.stringify({ version: 1, lanes: [{ id: 'L0', repo: 'example/console', branch: 'main', worktree: 'console', prompt: 'Coordinate', group: null }] }) + '\n');
  write(tree, 'orch/heartbeats/session-a.json', JSON.stringify({ sessionId: 'session-a', status: 'active', at: at(55) }) + '\n');
  write(tree, 'orch/inbox/L192/20261120T090100Z-L0-a1b2.json', JSON.stringify({ id: 'msg-1', from: 'L0', to: 'L192', body: 'Start with the contract package.', createdAt: at(60) }) + '\n');
}

function addQuestions(tree: AgentTree, options: AgentTreeOptions) {
  const text = options.includeSecrets ? secretShapes.map(secret => secret.value).join('\n') : 'Which retry limit should the queue use?';
  const revision = {
    v: 1, id: 'q-1', rev: 1, type: 'decision', priority: 'high', blocking: 'awaiting the retry limit', text,
    history: [{ seq: 1, type: 'created', ts: at(70) }],
  };
  write(tree, 'user-questions/items/q-1/r00000001.json', JSON.stringify(revision) + '\n');
}

function addWork(tree: AgentTree) {
  write(tree, 'jobs/job-1.log', 'started synthetic job\nprogress 50%\n');
  write(tree, 'issue-work/registry.jsonl', jsonl([{ repo: 'example/console', issue: 42, sessionId: 'session-a', state: 'in-progress', ts: at(75) }]));
  write(tree, 'pi-phase/state/ledger/2026-11-20.jsonl', jsonl([
    { v: 1, argvHash: 'hash-unit', label: 'unit checks', queuedAt: at(80), startedAt: at(81), endedAt: at(95), outcome: 'passed', exit: 0 },
  ]));
  write(tree, 'reviews/review-1.jsonl', jsonl([{ at: at(100), headSha: 'a'.repeat(40), verdict: 'approve' }]));
}

/** Appends one complete JSON line to a session file, for live-tail specs. */
export function appendSessionLine(file: string, row: unknown) {
  appendFileSync(file, JSON.stringify(row) + '\n');
}

export function buildAgentTree(root: string, options: AgentTreeOptions = {}): AgentTree {
  const tree: AgentTree = { root, orchRoot: join(root, 'orch'), sessions: [], files: [] };
  addSessions(tree, options);
  addContextBudget(tree);
  addLanes(tree);
  addQuestions(tree, options);
  addWork(tree);
  return tree;
}
