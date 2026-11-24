import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ageSeconds, jobDefs, messageText, models, questionDefs, requestAnswers, requestTexts, sessionSpend, turn, type Turn } from './content.ts';

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

const second = 1000;
const iso = (ms: number) => new Date(Math.round(ms / second) * second).toISOString();
/** The instant the snapshot is observed: noon, matching the media rig's fixed clock. Every fixture time is at or before it. */
export const observedAt = '2026-11-20T12:00:00.000Z';
const observed = Date.parse(observedAt);
const roleNames = ['coordinator', 'implementation', 'review', 'explore', 'scout'];
const branches = ['queue-checkpoints', 'retry-cancellation', 'cache-expiry', 'schema-compat', 'cli-help', 'test-isolation'];

/** A session lives from just before the replayed transcript (s2 starts with it) to its latest activity, which varies from seconds to hours before observation. */
function lifetime(index: number) {
  const status = statuses[index % statuses.length];
  const start = index === 1 ? epoch : epoch - 1800000 + (index % 6) * 300000;
  return { start, end: observed - ageSeconds[status][Math.floor(index / statuses.length)] * second };
}
const within = (index: number, fraction: number) => {
  const { start, end } = lifetime(index);
  return iso(start + (end - start) * fraction);
};

function makeSessions(rng: () => number) {
  return Array.from({ length: 30 }, (_, i) => {
    const group = Math.floor(i / 5);
    const slot = i % 5;
    const { start, end } = lifetime(i);
    const { costUsd, costIncomplete } = sessionSpend(i);
    const samples = Array.from({ length: 24 }, (_, n) => ({
      at: iso(start + (end - start) * n / 23), contextPercent: Math.round(15 + rng() * 75),
      tokens: Math.round(1200 + (costUsd ?? 0.3) * 900 * (0.6 + rng() * 0.8)),
      costUsd: costUsd === null ? 0 : Math.round(costUsd / 24 * (0.6 + rng() * 0.8) * 1000) / 1000,
    }));
    return {
      id: `s${i + 1}`, repositoryId: repositories[group], name: `${repositories[group]} ${roleNames[slot]}`,
      laneId: ['L0', 'L192', 'L193', 'L194', 'L195'][slot],
      role: ['orchestrator', 'main', 'main', 'subagent', 'subagent'][slot],
      parentSessionId: slot >= 3 ? `s${group * 5 + 2}` : null,
      orchestratorSessionId: `s${group * 5 + 1}`, branch: `feature/${branches[(group + slot) % branches.length]}`,
      cwd: `/synthetic/workspaces/${repositories[group]}`, model: models[(group + slot) % models.length],
      status: statuses[i % statuses.length], startedAt: iso(start), updatedAt: iso(end),
      contextPercent: samples.at(-1)!.contextPercent, samples, costUsd, costIncomplete,
    };
  });
}

function makeRequests() {
  return Array.from({ length: 12 }, (_, i) => {
    const owner = i < 3 ? 1 : i;
    const createdAt = i < 3 ? timestamp([2000, 5000, 9000][i]) : within(owner, 0.1 + i * 0.04);
    return {
      id: `r${i + 1}`, sessionId: `s${owner + 1}`, text: requestTexts[i],
      origin: ['human', 'launch', 'unproven'][i % 3],
      originLabel: ['Human request', 'Initial prompt', 'Unproven origin'][i % 3],
      originEvidence: ['Explicit synthetic user-input marker', 'Synthetic non-relaunch session-start marker', 'No positive origin evidence'][i % 3],
      status: ['interrupted', 'open', 'unanswered', 'answered'][i % 4],
      createdAt, resetId: i === 0 ? 'reset1' : null,
      answer: i % 4 === 3 ? { id: `a${i}`, text: requestAnswers[i], at: within(owner, 0.2 + i * 0.04), interim: false } : null,
      interimAnswers: i === 0 ? [{ id: 'a-partial', text: 'The first option bounds memory, but the comparison', at: timestamp(9000), interim: true }] : [],
    };
  });
}

function makeTranscript() {
  const kinds = ['user', 'thinking', 'assistant.delta', 'assistant.delta', 'tool.call', 'tool.result', 'diff', 'assistant'];
  const requestIds = ['r1', 'r2', 'r3'];
  return Array.from({ length: 2000 }, (_, i) => {
    const kind = i === 100 ? 'reset' : kinds[i % kinds.length];
    const call = Math.floor(i / 8);
    const content = turn(call);
    return {
      id: `entry${i + 1}`, cursor: i + 1, sessionId: 's2', at: timestamp(i * 180), kind,
      text: i === 100 ? 'Handoff: comparison interrupted; carried requests r1, r2.' : content.texts[i % kinds.length],
      toolCallId: [4, 5].includes(i % 8) ? `call${call}` : null,
      resetId: i === 100 ? 'reset1' : null,
      requestId: kind === 'user' ? requestIds[call % requestIds.length] : null,
      toolResult: toolResult(kind, content, content.texts[i % kinds.length]),
    };
  });
}

/** Structured tool result (API v1): call and result entries of the same call share tool name and args excerpt. */
function toolResult(kind: string, content: Turn, text: string) {
  if (kind !== 'tool.call' && kind !== 'tool.result') return null;
  return {
    toolName: 'read', argsExcerpt: content.file,
    resultKind: kind === 'tool.call' ? 'none' : content.failed ? 'error' : 'text',
    resultExcerpt: kind === 'tool.call' ? '' : text,
    truncated: kind === 'tool.result' && content.truncated, withheld: false,
  };
}

export function generate(seed = 192) {
  const rng = random(seed);
  const sessions = makeSessions(rng);
  const requests = makeRequests();
  const questions = Array.from({ length: 8 }, (_, i) => ({
    id: `q${i + 1}`, sessionId: `s${i + 1}`, kind: ['question', 'decision', 'approval', 'fyi'][i % 4],
    text: questionDefs[i].text, options: questionDefs[i].options, urgency: i % 2 ? 'normal' : 'high', blocking: i % 2 === 0,
    status: 'open', createdAt: within(i, 0.05 + i * 0.05),
  }));
  const messages = Array.from({ length: 40 }, (_, i) => {
    const from = Math.floor(i / 4) % 6 * 5;
    const to = from + 1 + i % 4;
    const start = Math.max(lifetime(from).start, lifetime(to).start);
    const end = Math.min(lifetime(from).end, lifetime(to).end);
    return {
      id: `m${i + 1}`, fromSessionId: `s${from + 1}`, toSessionId: `s${to + 1}`, text: messageText(i),
      status: ['sent', 'delivered', 'read'][i % 3], sentAt: iso(start + (end - start) * (0.05 + (i % 10) * 0.09)),
    };
  });
  const jobs = Array.from({ length: 9 }, (_, i) => ({
    id: `j${i + 1}`, sessionId: `s${i + 1}`, kind: jobDefs[i].kind, name: jobDefs[i].name,
    status: ['running', 'queued', 'done', 'failed'][i % 4],
    startedAt: within(i, 0.1 + i * 0.07), exitCode: i % 4 === 3 ? 1 : null,
  }));
  const resets = [{ id: 'reset1', sessionId: 's2', kind: 'handoff', at: timestamp(18000), carriedRequestIds: ['r1', 'r2'], interruptedRequestIds: ['r1'] }];
  const transcript = makeTranscript();
  const fixture = { version: 0, generatedAt: observedAt, repositories: repositories.map(id => ({ id, name: id })), sessions, requests, questions, messages, jobs, resets, transcript };
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
}
