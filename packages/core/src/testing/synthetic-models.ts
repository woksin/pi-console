import type { ReadModels } from '../projections/index.ts';

export interface SyntheticSize { sessions: number; jobs: number; messages: number; requests: number; questions: number }

const pad = (n: number) => String(n).padStart(7, '0');
/** Strictly increasing ISO timestamps, one second apart, so specs control ordering exactly. */
const at = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString();

/**
 * Read models built directly (no event log), so specs and acceptance checks can use tens of thousands of rows.
 * Deterministic: every field is a function of the row index. Most rows are finished; every `stride`-th is active.
 */
export function syntheticModels(size: SyntheticSize, stride = 997): ReadModels {
  const models: ReadModels = {
    sessions: { sessions: {} }, burn: { sessions: {} }, lanes: { lanes: {} }, questions: { questions: {} }, messages: { messages: {} },
    work: { jobs: {}, reviews: {} }, requests: { requests: {} },
  };
  const owner = (n: number) => `s${pad(n % Math.max(size.sessions, 1))}`;
  for (let n = 0; n < size.sessions; n++) {
    const id = `s${pad(n)}`;
    models.sessions.sessions[id] = {
      id, cwd: `/repo/${n % 5}`, model: 'm1', thinkingLevel: null, role: n % 7 === 0 ? 'subagent' : 'main', parentSessionId: n % 7 === 0 && n > 0 ? `s${pad(n - 1)}` : null,
      startedAt: at(n), updatedAt: at(n), endedAt: n % stride === 0 ? null : at(n + 1), endReason: 'exit', openTurnId: n % stride === 0 ? 't1' : null,
      heartbeatStatus: null, resets: [], lastRef: null, stamps: {}, turns: {}, latestTurnId: null, latestTurnKey: '',
    };
  }
  for (let n = 0; n < size.jobs; n++) {
    const id = `j${pad(n)}`;
    models.work.jobs[id] = { id, sessionId: owner(n), kind: 'job', name: id, status: n % stride === 0 ? 'running' : 'done', startedAt: at(n), exitCode: 0 };
  }
  for (let n = 0; n < size.messages; n++) {
    const id = `m${pad(n)}`;
    models.messages.messages[id] = { id, from: 'lane-a', to: 'lane-b', text: `hello ${n}`, withheld: false, status: n % stride === 0 ? 'sent' : 'read', sentAt: at(n) };
  }
  for (let n = 0; n < size.requests; n++) {
    const id = `r${pad(n)}`;
    models.requests.requests[id] = {
      id, sessionId: owner(n), text: `ask ${n}`, origin: 'human', originEvidence: 'spec', status: n % stride === 0 ? 'unanswered' : 'answered', createdAt: at(n),
      resetId: null, answer: null, interimAnswers: [], ref: null, stamps: {}, interruptedResetId: null,
    };
  }
  for (let n = 0; n < size.questions; n++) {
    const id = `k${pad(n)}`;
    models.questions.questions[id] = {
      id, asker: owner(n), kind: 'question', text: `decide ${n}`, options: [], urgency: 'normal', blocking: false,
      status: n % stride === 0 ? 'open' : 'closed', createdAt: at(n), ref: null, stamps: {},
    };
  }
  return models;
}
