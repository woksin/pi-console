import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { secretShapes } from './secret-shapes.ts';

/**
 * Builds a synthetic `~/.pi/agent`-like tree for adapter and daemon specs. Layout and entry shapes are the
 * testkit's own minimal stand-ins; source adapters (P2) extend it under fixtures/sources with the real
 * formats they implement. Deterministic: no clock, no randomness.
 */
export interface AgentTreeOptions {
  /** Leave the last line of every session file unterminated (a write in progress). */
  tornLastLine?: boolean;
  /** Embed every secret shape in one user message and one question, to prove redaction end to end. */
  includeSecrets?: boolean;
}

export interface AgentTree {
  root: string;
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
  const status = { sessionId: 'session-a', percent: 61, tokens: 122000, updatedAt: at(50) };
  write(tree, 'context-budget/status/session-a.json', JSON.stringify(status) + '\n');
  write(tree, 'context-budget/events.jsonl', jsonl([{ at: at(20), sessionId: 'session-a', event: 'threshold', percent: 55 }, { at: at(45), sessionId: 'session-a', event: 'handoff', percent: 80 }]));
  write(tree, 'context-budget/turns.jsonl', jsonl([{ at: at(11), sessionId: 'session-a', turn: 1, tokens: 90000 }, { at: at(31), sessionId: 'session-a', turn: 2, tokens: 122000 }]));
  write(tree, 'context-budget/handoffs/session-a.md', '# Handoff\n\nCarried requests: none.\n');
}

function addLanes(tree: AgentTree) {
  write(tree, 'lanes/registry.json', JSON.stringify({ lanes: [{ id: 'L0', name: 'coordinator' }, { id: 'L192', name: 'implementation' }] }) + '\n');
  write(tree, 'lanes/status/L192.json', JSON.stringify({ lane: 'L192', status: 'waiting', waitingOn: 'user', updatedAt: at(60) }) + '\n');
  write(tree, 'lanes/messages/20261120T090100Z-L0-to-L192.json', JSON.stringify({ id: 'msg-1', from: 'L0', to: 'L192', sentAt: at(60), text: 'Start with the contract package.' }) + '\n');
  write(tree, 'heartbeats/session-a.json', JSON.stringify({ sessionId: 'session-a', status: 'working', at: at(55) }) + '\n');
}

function addQuestions(tree: AgentTree, options: AgentTreeOptions) {
  const text = options.includeSecrets ? secretShapes.map(secret => secret.value).join('\n') : 'Which retry limit should the queue use?';
  const revision = { id: 'q-1', sessionId: 'session-a', kind: 'decision', urgency: 'high', blocking: true, text, options: ['3', '4'], at: at(70) };
  write(tree, 'questions/q-1/rev-0001.json', JSON.stringify(revision) + '\n');
}

function addWork(tree: AgentTree) {
  write(tree, 'jobs/job-1.log', 'started synthetic job\nprogress 50%\n');
  write(tree, 'phases/ledger-2026-11-20.jsonl', jsonl([
    { at: at(80), phase: 'unit checks', event: 'queued' }, { at: at(81), phase: 'unit checks', event: 'started' }, { at: at(95), phase: 'unit checks', event: 'finished', exitCode: 0 },
  ]));
  write(tree, 'reviews/review-1.jsonl', jsonl([{ at: at(100), headSha: 'a'.repeat(40), verdict: 'approve' }]));
}

/** Appends one complete JSON line to a session file, for live-tail specs. */
export function appendSessionLine(file: string, row: unknown) {
  appendFileSync(file, JSON.stringify(row) + '\n');
}

export function buildAgentTree(root: string, options: AgentTreeOptions = {}): AgentTree {
  const tree: AgentTree = { root, sessions: [], files: [] };
  addSessions(tree, options);
  addContextBudget(tree);
  addLanes(tree);
  addQuestions(tree, options);
  addWork(tree);
  return tree;
}
