import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { schema } from './schema.ts';

export const statuses = ['working', 'needs-you', 'blocked', 'waiting', 'idle', 'done', 'failed'] as const;
const repositories = ['aurora', 'harbor', 'meadow', 'quartz', 'willow', 'zenith'];
const epoch = Date.parse('2026-11-20T09:00:00Z');
export const timestamp = (ms: number) => new Date(epoch + ms).toISOString();
export function random(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function makeSessions(rng: () => number) {
  return Array.from({ length: 30 }, (_, i) => {
    const group = Math.floor(i / 5);
    const slot = i % 5;
    const samples = Array.from({ length: 24 }, (_, n) => ({
      at: timestamp(n * 60000), contextPercent: Math.round(15 + rng() * 75),
      tokens: Math.round(500 + rng() * 4000), costUsd: Math.round(rng() * 90) / 100,
    }));
    return {
      id: `s${i + 1}`, repositoryId: repositories[group], name: `${repositories[group]} ${['coordinator', 'implementation', 'review', 'explore', 'scout'][slot]}`,
      laneId: ['L0', 'L192', 'L193', 'L194', 'L195'][slot],
      role: ['orchestrator', 'main', 'main', 'subagent', 'subagent'][slot],
      parentSessionId: slot >= 3 ? `s${group * 5 + 2}` : null,
      orchestratorSessionId: `s${group * 5 + 1}`, branch: `spike/${repositories[group]}-${slot}`,
      cwd: `/synthetic/workspaces/${repositories[group]}`, model: slot % 2 ? 'synthetic-fast' : 'synthetic-reasoner',
      status: statuses[i % statuses.length], startedAt: timestamp(0), updatedAt: timestamp(1380000),
      contextPercent: samples.at(-1)!.contextPercent, samples,
    };
  });
}

function makeRequests() {
  return Array.from({ length: 12 }, (_, i) => ({
    id: `r${i + 1}`, sessionId: i < 3 ? 's2' : `s${i + 1}`,
    text: ['Compare the queue strategies and explain the trade-offs.', 'Write the handoff and preserve the pending decisions.', 'Check whether the retry policy handles partial results.'][i % 3],
    origin: ['human', 'launch', 'unproven'][i % 3],
    originLabel: ['Human request', 'Initial prompt', 'Unproven origin'][i % 3],
    originEvidence: ['Explicit synthetic user-input marker', 'Synthetic non-relaunch session-start marker', 'No positive origin evidence'][i % 3],
    status: ['interrupted', 'open', 'unanswered', 'answered'][i % 4],
    createdAt: timestamp(i * 1000), resetId: i === 0 ? 'reset1' : null,
    answer: i % 4 === 3 ? { id: `a${i}`, text: 'Use bounded retries with an explicit checkpoint.', at: timestamp(10000 + i * 1000), interim: false } : null,
    interimAnswers: i === 0 ? [{ id: 'a-partial', text: 'The first option bounds memory, but the comparison', at: timestamp(9000), interim: true }] : [],
  }));
}

function makeTranscript() {
  const kinds = ['user', 'thinking', 'assistant.delta', 'assistant.delta', 'tool.call', 'tool.result', 'diff', 'assistant'];
  const texts = [
    'Inspect the synthetic queue and propose a bounded retry policy.',
    'I will compare the checkpoint boundaries before changing the queue.',
    'A bounded queue ', 'keeps the retry budget predictable. ',
    'read src/queue.ts', 'export const retryLimit = 3; // synthetic example',
    '--- a/src/queue.ts\n+++ b/src/queue.ts\n@@ -1 +1 @@\n-export const retryLimit = 3;\n+export const retryLimit = 4;',
    'The retry budget is bounded; the focused checks pass.',
  ];
  return Array.from({ length: 2000 }, (_, i) => ({
    id: `entry${i + 1}`, cursor: i + 1, sessionId: 's2', at: timestamp(i * 180),
    kind: i === 100 ? 'reset' : kinds[i % kinds.length],
    text: i === 100 ? 'Handoff: comparison interrupted; carried requests r1, r2.' : texts[i % texts.length],
    toolCallId: [4, 5].includes(i % 8) ? `call${Math.floor(i / 8)}` : null,
    resetId: i === 100 ? 'reset1' : null,
  }));
}

export function generate(seed = 192) {
  const rng = random(seed);
  const sessions = makeSessions(rng);
  const requests = makeRequests();
  const questions = Array.from({ length: 8 }, (_, i) => ({
    id: `q${i + 1}`, sessionId: `s${i + 1}`, kind: ['question', 'decision', 'approval', 'fyi'][i % 4],
    text: ['Which retention window should the cache use?', 'May the synthetic migration proceed?'][i % 2],
    options: ['Keep 14 days', 'Keep 30 days'], urgency: i % 2 ? 'normal' : 'high', blocking: i % 2 === 0,
    status: 'open', createdAt: timestamp(i * 2000),
  }));
  const messages = Array.from({ length: 40 }, (_, i) => ({
    id: `m${i + 1}`, fromSessionId: `s${Math.floor(i / 4) % 6 * 5 + 1}`,
    toSessionId: `s${Math.floor(i / 4) % 6 * 5 + 2 + i % 4}`,
    text: ['Please verify the checkpoint contract.', 'Review complete; the bounded queue looks consistent.', 'Waiting for the migration decision.', 'The focused checks passed; ready for handoff.'][i % 4],
    status: ['sent', 'delivered', 'read'][i % 3], sentAt: timestamp(i * 3000),
  }));
  const jobs = Array.from({ length: 9 }, (_, i) => ({
    id: `j${i + 1}`, sessionId: `s${i + 1}`, kind: ['job', 'phase', 'ci'][i % 3],
    name: ['watch inbox', 'unit checks', 'release verification'][i % 3],
    status: ['running', 'queued', 'done', 'failed'][i % 4],
    startedAt: timestamp(i * 1000), exitCode: i % 4 === 3 ? 1 : null,
  }));
  const resets = [{ id: 'reset1', sessionId: 's2', kind: 'handoff', at: timestamp(18000), carriedRequestIds: ['r1', 'r2'], interruptedRequestIds: ['r1'] }];
  const transcript = makeTranscript();
  const fixture = { version: 0, generatedAt: timestamp(0), repositories: repositories.map(id => ({ id, name: id })), sessions, requests, questions, messages, jobs, resets, transcript };
  const timeline = [
    ...transcript.map((entry, i) => ({ t: i * 180, type: 'transcript.appended', payload: entry })),
    ...sessions.map((session, i) => ({ t: i * 900, type: 'session.updated', payload: { ...session, status: statuses[(i + 1) % statuses.length] } })),
    ...requests.map((request, i) => ({ t: i * 1200, type: `request.${request.status === 'interrupted' ? 'interrupted' : 'observed'}`, payload: request })),
    ...questions.map((question, i) => ({ t: i * 1400, type: 'question.asked', payload: question })),
    ...messages.map((message, i) => ({ t: i * 1500, type: 'message.sent', payload: message })),
    ...jobs.map((job, i) => ({ t: i * 1800, type: `job.${job.status === 'done' || job.status === 'failed' ? 'finished' : 'updated'}`, payload: job })),
    { t: 18000, type: 'reset.occurred', payload: resets[0] },
  ].sort((a, b) => a.t - b.t);
  return { fixture, timeline };
}

export function writeFixture(directory = fileURLToPath(new URL('./data/', import.meta.url))) {
  const { fixture, timeline } = generate();
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'fixture.json'), JSON.stringify(fixture, null, 2) + '\n');
  writeFileSync(resolve(directory, 'stream.jsonl'), timeline.map(event => JSON.stringify(event)).join('\n') + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFixture(process.argv[2]);
  const directory = fileURLToPath(new URL('../../docs/api/schemas/', import.meta.url));
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'api.json'), JSON.stringify(schema, null, 2) + '\n');
  writeFileSync(resolve(directory, 'intervention-input.json'), JSON.stringify({ $schema: schema.$schema, $ref: 'api.json#/$defs/interventionInput' }, null, 2) + '\n');
}
