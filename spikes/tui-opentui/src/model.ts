export type Sample = { at: string; contextPercent: number; tokens: number; costUsd: number };
export type Session = {
  id: string; repositoryId: string; name: string; laneId: string; role: string;
  parentSessionId: string | null; branch: string; model: string; status: string;
  startedAt: string; updatedAt: string; contextPercent: number; samples: Sample[];
};
export type Request = {
  id: string; sessionId: string; text: string; origin: string; status: string; createdAt: string;
  answer: { text: string; at: string } | null; interimAnswers: { text: string; at: string }[]; resetId: string | null;
};
export type Question = { id: string; sessionId: string; text: string; status: string; blocking: boolean; createdAt: string };
export type Message = { id: string; fromSessionId: string; toSessionId: string; text: string; status: string; sentAt: string };
export type Intervention = { id: string; type: string; sessionId: string; text: string; recordedAt: string; result: string };
export type Job = { id: string; sessionId: string; name: string; status: string; exitCode: number | null };
export type Reset = { id: string; sessionId: string; kind: string; at: string; carriedRequestIds: string[]; interruptedRequestIds: string[] };
export type Entry = { id: string; sessionId: string; cursor: number; at: string; kind: string; text: string; resetId: string | null; toolCallId: string | null };
export type Snapshot = { sessions: Session[]; requests: Request[]; questions: Question[]; jobs: Job[]; resets: Reset[]; messages: Message[]; interventions: Intervention[] };
export type Event = { seq: number; type: string; payload: unknown };
export type State = Snapshot & {
  connected: boolean; error: string; entries: Map<string, Entry[]>;
  changed: Map<string, number>; received: number; revision: number;
  pulses: Map<string, number>; volumes: Map<string, number>; liveAt: number;
};
export const edgeKey = (a: string, b: string) => [a, b].sort().join('~');
const empty = (): State => ({ sessions: [], requests: [], questions: [], jobs: [], resets: [], messages: [], interventions: [], connected: false, error: '', entries: new Map(), changed: new Map(), pulses: new Map(), volumes: new Map(), liveAt: 0, received: 0, revision: 0 });
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
      Object.assign(s, snapshot, { entries: new Map(), pulses: new Map(), volumes: new Map() });
      for (const message of s.messages) {
        const key = edgeKey(message.fromSessionId, message.toSessionId);
        s.volumes.set(key, (s.volumes.get(key) ?? 0) + 1);
      }
      s.liveAt = Math.max(0, ...s.messages.map(m => Date.parse(m.sentAt)));
    } else if (event.type === 'transcript.appended') {
      const entry = event.payload as Entry;
      this.append([entry]);
      s.liveAt = Date.parse(entry.at);
    }
    else this.project(event);
    this.dirty = true;
  }
  private project(event: Event) {
    const s = this.state;
    if (event.type === 'session.updated') this.sessionUpdated(event.payload as Session);
    if (event.type.startsWith('request.')) upsert(s.requests, event.payload as Request);
    if (event.type === 'question.asked') upsert(s.questions, event.payload as Question);
    if (event.type.startsWith('job.')) upsert(s.jobs, event.payload as Job);
    if (event.type === 'reset.occurred') upsert(s.resets, event.payload as Reset);
    if (event.type === 'message.sent') {
      const message = event.payload as Message;
      upsert(s.messages, message);
      const key = edgeKey(message.fromSessionId, message.toSessionId);
      s.pulses.set(key, Date.now());
      s.volumes.set(key, (s.volumes.get(key) ?? 0) + 1);
      s.liveAt = Date.parse(message.sentAt);
    }
    if (event.type === 'intervention.recorded') this.recordIntervention(event.payload as Intervention);
  }
  private sessionUpdated(item: Session) {
    const s = this.state;
    if (s.sessions.find(old => old.id === item.id)?.status !== item.status) s.changed.set(item.id, Date.now());
    upsert(s.sessions, item);
  }
  private recordIntervention(item: Intervention) {
    upsert(this.state.interventions, item);
    if (this.state.interventions.length > 100) this.state.interventions.shift();
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
