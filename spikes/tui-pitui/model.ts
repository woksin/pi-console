import type { generate } from '../fixture/generate.ts';

type Fixture = ReturnType<typeof generate>['fixture'];
export type Session = Fixture['sessions'][number];
export type Entry = Fixture['transcript'][number];
export type Request = Fixture['requests'][number];
export type Snapshot = Omit<Fixture, 'transcript'>;
export type Event = { seq: number; type: string; payload: any };
export const RETAIN = 5000;

export class Model {
  data: Snapshot = { version: 0, generatedAt: '', repositories: [], sessions: [], requests: [], questions: [], messages: [], jobs: [], resets: [] };
  entries = new Map<string, Entry[]>();
  changed = new Map<string, number>();
  revision = 0;
  sequence = 0;
  received = 0;
  connected = false;
  error = 'Connecting to the mock daemon…';
  selected = 's2';
  screen: 'fleet' | 'detail' = 'fleet';
  needsOnly = false;
  follow = true;
  offset = 0;
  unseen = 0;
  search = '';
  expanded = new Set<string>();
  focus = 0;
  railOffset = 0;
  fleetOffset = 0;

  apply(event: Event) {
    this.sequence = event.seq;
    this.received++;
    this.revision++;
    if (event.type === 'snapshot') {
      this.data = event.payload;
      this.entries.clear();
      return;
    }
    if (event.type === 'transcript.appended') {
      this.append(event.payload);
      if (!this.follow && event.payload.sessionId === this.selected) this.unseen++;
      return;
    }
    const collections = {
      'session.updated': 'sessions', 'request.observed': 'requests',
      'request.interrupted': 'requests', 'question.asked': 'questions',
      'job.updated': 'jobs', 'job.finished': 'jobs', 'reset.occurred': 'resets',
    } as const;
    const key = collections[event.type as keyof typeof collections];
    if (key) {
      const items = this.data[key] as { id: string }[];
      const index = items.findIndex(item => item.id === event.payload.id);
      if (index < 0) items.push(event.payload);
      else items[index] = event.payload;
      if (key === 'sessions') this.changed.set(event.payload.id, Date.now());
    }
  }

  append(entry: Entry) {
    const items = this.entries.get(entry.sessionId) ?? [];
    if (entry.cursor <= (items.at(-1)?.cursor ?? 0)) return;
    items.push(entry);
    // Amortized trimming avoids shifting 5,000 elements on every incoming event.
    if (items.length > RETAIN + 500) items.splice(0, items.length - RETAIN);
    this.entries.set(entry.sessionId, items);
  }

  mergeHistory(sessionId: string, history: Entry[]) {
    const unique = new Map(history.map(entry => [entry.cursor, entry]));
    for (const entry of this.entries.get(sessionId) ?? []) unique.set(entry.cursor, entry);
    this.entries.set(sessionId, [...unique.values()].sort((a, b) => a.cursor - b.cursor).slice(-RETAIN));
    this.revision++;
  }

  get session() { return this.data.sessions.find(session => session.id === this.selected); }
  get transcript() { return this.entries.get(this.selected) ?? []; }
  get sessions() { return this.data.sessions.filter(session => !this.needsOnly || session.status === 'needs-you'); }

  select(id: string) {
    this.selected = id;
    this.offset = 0;
    this.railOffset = 0;
    this.follow = true;
    this.unseen = 0;
  }

  scroll(delta: number) {
    this.follow = false;
    this.offset = Math.max(0, this.offset + delta);
  }

  tail() { this.follow = true; this.offset = 0; this.unseen = 0; }
}

export function origin(request: Request) {
  return { human: 'you', launch: 'initial prompt', unproven: 'origin not verified' }[request.origin];
}

export function activity(model: Model, session: Session) {
  const question = model.data.questions.find(item => item.sessionId === session.id && item.status === 'open');
  if (question) return question.text;
  const job = model.data.jobs.find(item => item.sessionId === session.id && item.status === 'running');
  if (job) return job.name;
  const entry = model.entries.get(session.id)?.at(-1);
  if (entry) return entry.text.replace(/\n/g, ' ');
  return `${session.status} · ${session.branch}`;
}

export function fleetRows(model: Model): { label?: string; session?: Session }[] {
  const rows: { label?: string; session?: Session }[] = [];
  for (const repo of model.data.repositories) {
    const sessions = model.sessions.filter(session => session.repositoryId === repo.id);
    if (!sessions.length) continue;
    rows.push({ label: `${repo.name}  /  ${sessions.length} sessions` });
    for (const parent of sessions.filter(session => !session.parentSessionId)) {
      rows.push({ session: parent });
      for (const child of sessions.filter(session => session.parentSessionId === parent.id)) rows.push({ session: child });
    }
    // Filtered subagents remain reachable even when their parent is hidden.
    for (const child of sessions.filter(session => session.parentSessionId && !sessions.some(parent => parent.id === session.parentSessionId))) rows.push({ session: child });
  }
  return rows;
}
