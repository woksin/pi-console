import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import type { generate } from '../fixture/generate.ts';
import { HttpError } from './security.ts';
import { derivedRequest } from './requests-derived.ts';
import { sessionDeltas } from './session-deltas.ts';

type Fixture = ReturnType<typeof generate>['fixture'];
export type StreamEvent = { seq: number; type: string; occurredAt: string; payload: unknown };
type TimelineEntry = { t: number; type: string; payload: unknown };
function upsert<T extends { id: string }>(items: T[], item: T) {
  const index = items.findIndex(existing => existing.id === item.id);
  if (index < 0) items.push(item);
  else items[index] = item;
}
function resumeSequence(lastId: string | undefined, current: number) {
  if (lastId === undefined) return undefined;
  if (!/^\d+$/.test(lastId)) throw new HttpError(400, 'Invalid Last-Event-ID');
  const after = Number(lastId);
  if (!Number.isSafeInteger(after)) throw new HttpError(400, 'Invalid Last-Event-ID');
  if (after > current) throw new HttpError(400, 'Invalid Last-Event-ID');
  return after;
}
function project(fixture: Fixture, type: string, payload: unknown) {
  const collections = {
    'session.updated': fixture.sessions, 'request.observed': fixture.requests,
    'request.interrupted': fixture.requests, 'question.asked': fixture.questions,
    'message.sent': fixture.messages, 'job.updated': fixture.jobs,
    'job.finished': fixture.jobs, 'reset.occurred': fixture.resets,
  };
  const items = collections[type as keyof typeof collections];
  if (items) upsert(items as { id: string }[], payload as { id: string });
}
export function createStore(speed: number, rate?: number, replayWindow = 10000) {
  const fixture: Fixture = JSON.parse(readFileSync(new URL('../fixture/data/fixture.json', import.meta.url), 'utf8'));
  const timeline: TimelineEntry[] = readFileSync(new URL('../fixture/data/stream.jsonl', import.meta.url), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  fixture.requests = fixture.requests.map(request => derivedRequest(fixture, request));
  for (const event of timeline) if (event.type.startsWith('request.')) event.payload = derivedRequest(fixture, event.payload as Fixture['requests'][number]);
  const entries = rate ? timeline.filter(event => event.type !== 'transcript.appended') : timeline;
  const clients = new Set<ServerResponse>();
  const history: StreamEvent[] = [];
  const sessionBases = new Map<string, Fixture['sessions'][number]['status']>();
  const interventions: Record<string, unknown>[] = [];
  let seq = 0;
  let cursor = fixture.transcript.at(-1)!.cursor;
  let position = 0;
  let cycle = 0;
  let stressPosition = 0;
  let stressSent = 0;
  const started = performance.now();
  const duration = timeline.at(-1)!.t + 1000;
  const templates = structuredClone(fixture.transcript);

  function publish(type: string, original: unknown) {
    let event: StreamEvent | undefined;
    const sessions = sessionDeltas(fixture, sessionBases, { type, payload: original }, () => { event = publishEntity(type, original); });
    for (const session of sessions) publishEntity('session.updated', session);
    return event!;
  }
  function publishEntity(type: string, original: unknown) {
    let payload = structuredClone(original);
    if (type === 'transcript.appended') {
      const entry = { ...(payload as Fixture['transcript'][number]), cursor: ++cursor, id: `live-entry${cursor}` };
      fixture.transcript.push(entry);
      if (fixture.transcript.length > 5000) fixture.transcript.shift();
      payload = entry;
    } else project(fixture, type, payload);
    const event = { seq: ++seq, type, occurredAt: new Date().toISOString(), payload };
    history.push(event);
    if (history.length > replayWindow) history.shift();
    for (const client of clients) send(client, event);
    return event;
  }
  function tick() {
    const elapsed = (performance.now() - started) * speed;
    let budget = 500;
    while (budget-- > 0 && elapsed >= cycle * duration + entries[position].t) {
      publish(entries[position].type, entries[position].payload);
      position++;
      if (position === entries.length) { position = 0; cycle++; }
    }
    if (rate) streamStress((performance.now() - started) / 1000, rate);
  }
  function streamStress(seconds: number, linesPerSecond: number) {
    const target = Math.floor(seconds * linesPerSecond);
    const count = Math.min(target - stressSent, 1000);
    for (let i = 0; i < count; i++) {
      publish('transcript.appended', templates[stressPosition++ % templates.length]);
      stressSent++;
    }
  }
  function snapshot() {
    const { transcript, ...rest } = fixture;
    return { ...rest, transcriptCursors: fixture.sessions.map(session => ({
      sessionId: session.id, cursor: transcript.findLast(entry => entry.sessionId === session.id)?.cursor ?? 0,
    })), interventions };
  }
  function send(client: ServerResponse, event: StreamEvent) {
    client.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    if (client.writableLength > 1048576) {
      clients.delete(client);
      client.destroy(); // A slow consumer reconnects with its last fully received id.
    }
  }
  function connect(client: ServerResponse, lastId: string | undefined) {
    const after = resumeSequence(lastId, seq);
    client.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    client.flushHeaders();
    const earliest = history[0]?.seq ?? seq + 1;
    if (after === undefined || after < earliest - 1) {
      send(client, { seq, type: 'snapshot', occurredAt: new Date().toISOString(), payload: snapshot() });
    } else {
      history.filter(event => event.seq > after).forEach(event => send(client, event));
    }
    if (!client.destroyed) clients.add(client);
    client.on('close', () => clients.delete(client));
  }
  const timer = setInterval(tick, 10);
  const heartbeat = setInterval(() => { for (const client of clients) client.write(': heartbeat\n\n'); }, 15000);
  return {
    fixture, interventions, publish, connect, snapshot, seq: () => seq, clients: () => clients.size,
    close() { clearInterval(timer); clearInterval(heartbeat); for (const client of clients) client.destroy(); },
  };
}
export type Store = ReturnType<typeof createStore>;
