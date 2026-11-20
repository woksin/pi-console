export type Sample = { at: string; contextPercent: number; tokens: number; costUsd: number };
export type Session = {
  id: string; repositoryId: string; name: string; laneId: string; role: string;
  parentSessionId: string | null; branch: string; model: string; status: string;
  startedAt: string; updatedAt: string; contextPercent: number; samples: Sample[];
};
export type Request = {
  id: string; sessionId: string; text: string; origin: string; status: string;
  answer: { text: string } | null; interimAnswers: { text: string }[]; resetId: string | null;
};
export type Question = { id: string; sessionId: string; text: string; status: string; blocking: boolean };
export type Job = { id: string; sessionId: string; name: string; status: string; exitCode: number | null };
export type Reset = { id: string; sessionId: string; kind: string; carriedRequestIds: string[]; interruptedRequestIds: string[] };
export type Entry = { id: string; sessionId: string; cursor: number; at: string; kind: string; text: string; resetId: string | null; toolCallId: string | null };
export type Snapshot = { sessions: Session[]; requests: Request[]; questions: Question[]; jobs: Job[]; resets: Reset[] };
export type Event = { seq: number; type: string; payload: unknown };
export type State = Snapshot & {
  connected: boolean; error: string; entries: Map<string, Entry[]>;
  changed: Map<string, number>; received: number; revision: number;
};
const empty = (): State => ({ sessions: [], requests: [], questions: [], jobs: [], resets: [], connected: false, error: '', entries: new Map(), changed: new Map(), received: 0, revision: 0 });
function upsert<T extends { id: string }>(items: T[], item: T) {
  const index = items.findIndex(old => old.id === item.id);
  if (index < 0) items.push(item);
  else items[index] = item;
}
export class Store {
  state = empty();
  private listeners = new Set<() => void>();
  private dirty = false;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  version = () => this.state.revision;
  flush = () => {
    if (!this.dirty) return;
    this.dirty = false;
    this.state.revision++;
    this.listeners.forEach(listener => listener());
  };
  connection(connected: boolean, error = '') { Object.assign(this.state, { connected, error }); this.dirty = true; }
  append(entries: Entry[]) {
    for (const entry of entries) {
      let items = this.state.entries.get(entry.sessionId);
      if (!items) { items = []; this.state.entries.set(entry.sessionId, items); }
      if ((items.at(-1)?.cursor ?? 0) >= entry.cursor) continue;
      items.push(entry);
      if (items.length > 2500) items.splice(0, items.length - 2500);
      this.state.received++;
    }
    this.dirty = true;
  }
  apply(event: Event) {
    const s = this.state;
    if (event.type === 'snapshot') {
      const snapshot = event.payload as Snapshot;
      Object.assign(s, snapshot, { entries: new Map() });
    } else if (event.type === 'transcript.appended') this.append([event.payload as Entry]);
    else this.project(event);
    this.dirty = true;
  }
  private project(event: Event) {
    const s = this.state;
    if (event.type === 'session.updated') {
      const item = event.payload as Session;
      if (s.sessions.find(old => old.id === item.id)?.status !== item.status) s.changed.set(item.id, Date.now());
      upsert(s.sessions, item);
    }
    if (event.type.startsWith('request.')) upsert(s.requests, event.payload as Request);
    if (event.type === 'question.asked') upsert(s.questions, event.payload as Question);
    if (event.type.startsWith('job.')) upsert(s.jobs, event.payload as Job);
    if (event.type === 'reset.occurred') upsert(s.resets, event.payload as Reset);
  }
}

// Never allow daemon text to inject terminal controls, bidi overrides or hyperlinks.
export function clean(text: string) {
  return text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '');
}
export const clip = (text: string, width: number) => {
  const chars = [...clean(text).replace(/\n/g, ' ')];
  return chars.length > width ? chars.slice(0, Math.max(0, width - 1)).join('') + '…' : chars.join('');
};
export function fuzzy(query: string, text: string) {
  let index = 0;
  for (const char of text.toLowerCase()) if (char === query.toLowerCase()[index]) index++;
  return index === query.length;
}
export function attention(s: State, session: Session) {
  return session.status === 'needs-you' || s.questions.some(q => q.sessionId === session.id && q.blocking && q.status === 'open') || s.requests.some(r => r.sessionId === session.id && ['unanswered', 'interrupted'].includes(r.status));
}
export function activity(s: State, session: Session) {
  const last = s.entries.get(session.id)?.at(-1);
  if (last) return `${last.kind}: ${last.text}`;
  const job = s.jobs.find(j => j.sessionId === session.id);
  return job ? `${job.name} · ${job.status}` : `${session.status} · ${session.branch}`;
}
export function totals(sessions: Session[]) {
  return sessions.reduce((sum, session) => ({ tokens: sum.tokens + session.samples.reduce((n, x) => n + x.tokens, 0), cost: sum.cost + session.samples.reduce((n, x) => n + x.costUsd, 0) }), { tokens: 0, cost: 0 });
}
