import type { Session, ThemeToken } from '@pi-console/contract';
import { badge, clean, clip, clock, type Badge } from '../common/format.ts';
import { displayStatus } from '../common/sessions.ts';
import { repositoryName, type ConsoleState } from '../state/index.ts';

export const zoomLevels = [300_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 14_400_000, 28_800_000, 86_400_000] as const;

export interface TimelineContext {
  /** Index into `zoomLevels`; default is the smallest level that fits the data. */
  zoom?: number;
  /** Pan in ms relative to "now" (negative is earlier). */
  offsetMs?: number;
  subagents?: boolean;
  messages?: boolean;
}

export type SpanKind = 'working' | 'waiting' | 'blocked' | 'idle';

/** Spans and markers are positioned as fractions (0..1) of the window; each client maps them to pixels or terminal columns. */
export interface TimelineSpan { kind: SpanKind; from: number; to: number }

export interface TimelineMarker { id: string; sessionId: string; at: number; glyph: string; kind: 'request' | 'answer' | 'reset' | 'question' | 'intervention' | 'message'; label: string; color: ThemeToken; time: string }

export interface TimelineRow { id: string; label: string; laneId: string; depth: 0 | 1; badge: Badge; spans: TimelineSpan[]; markers: TimelineMarker[] }

export interface TimelineGroup { id: string; name: string; rows: TimelineRow[] }

export interface TimelineViewModel {
  groups: TimelineGroup[];
  order: string[];
  window: { start: number; end: number; spanMs: number; zoom: number; label: string };
  ticks: { at: number; label: string }[];
  legend: { glyph: string; label: string }[];
  empty: boolean;
}

/** A sample interval is "working" when it burned at least this many tokens: the sample series is the only activity signal in the read models. */
export const workingTokenThreshold = 1000;
const sampleMs = 60_000;

const legend = [
  { glyph: '█', label: 'working' }, { glyph: '▒', label: 'waiting' }, { glyph: '▓', label: 'blocked' }, { glyph: '░', label: 'idle' },
  { glyph: '┃', label: 'reset' }, { glyph: '▲', label: 'request' }, { glyph: '▼', label: 'answer' }, { glyph: '●', label: 'question' }, { glyph: '◆', label: 'intervention' },
];

function dataStart(state: ConsoleState): number {
  const times = state.sessions.flatMap(session => session.samples.map(sample => Date.parse(sample.at)));
  return times.length > 0 ? Math.min(...times) : state.liveAt;
}

function windowFor(state: ConsoleState, context: TimelineContext): TimelineViewModel['window'] {
  const end = state.liveAt + (context.offsetMs ?? 0);
  const fit = zoomLevels.findIndex(level => level >= state.liveAt - dataStart(state));
  const zoom = Math.max(0, Math.min(zoomLevels.length - 1, context.zoom ?? (fit < 0 ? zoomLevels.length - 1 : fit)));
  const spanMs = zoomLevels[zoom];
  return { start: end - spanMs, end, spanMs, zoom, label: spanMs >= 3_600_000 ? `${String(spanMs / 3_600_000)}h` : `${String(spanMs / 60_000)}m` };
}

const fraction = (at: number, window: TimelineViewModel['window']): number => (at - window.start) / window.spanMs;

function spanKinds(session: Session): { from: number; to: number; kind: SpanKind }[] {
  return session.samples.map((sample, index) => {
    const from = Date.parse(sample.at);
    const last = index === session.samples.length - 1;
    const kind: SpanKind = sample.tokens >= workingTokenThreshold ? 'working' : 'idle';
    const override: SpanKind = session.status === 'waiting' ? 'waiting' : session.status === 'blocked' ? 'blocked' : kind;
    return { from, to: from + sampleMs, kind: last ? override : kind };
  });
}

function spansFor(session: Session, window: TimelineViewModel['window']): TimelineSpan[] {
  const merged: TimelineSpan[] = [];
  for (const span of spanKinds(session)) {
    const from = Math.max(0, fraction(span.from, window));
    const to = Math.min(1, fraction(span.to, window));
    if (to <= from) continue;
    const last = merged.at(-1);
    if (last?.kind === span.kind && Math.abs(last.to - from) < 1e-9) last.to = to;
    else merged.push({ kind: span.kind, from, to });
  }
  return merged;
}

interface RawMarker extends Omit<TimelineMarker, 'at' | 'time'> { atMs: number }

function rawMarkers(state: ConsoleState, withMessages: boolean): RawMarker[] {
  const out: RawMarker[] = [];
  for (const request of state.requests) {
    out.push({ id: request.id, sessionId: request.sessionId, atMs: Date.parse(request.createdAt), glyph: '▲', kind: 'request', label: `${request.originLabel} · ${request.status}: ${clip(request.text, 80)}`, color: request.status === 'interrupted' ? 'pink' : 'blue' });
    if (request.answer) out.push({ id: `${request.id}:answer`, sessionId: request.sessionId, atMs: Date.parse(request.answer.at), glyph: '▼', kind: 'answer', label: `Final answer: ${clip(request.answer.text, 80)}`, color: 'green' });
  }
  for (const reset of state.resets) out.push({ id: reset.id, sessionId: reset.sessionId, atMs: Date.parse(reset.at), glyph: '┃', kind: 'reset', label: `${reset.kind}: carried ${String(reset.carriedRequestIds.length)}, interrupted ${String(reset.interruptedRequestIds.length)}`, color: 'pink' });
  for (const question of state.questions) out.push({ id: question.id, sessionId: question.sessionId, atMs: Date.parse(question.createdAt), glyph: '●', kind: 'question', label: `Question (${question.status}): ${clip(question.text, 80)}`, color: 'amber' });
  for (const item of state.interventions) out.push({ id: item.id, sessionId: item.sessionId, atMs: Date.parse(item.recordedAt), glyph: '◆', kind: 'intervention', label: `${item.type}: ${clip(item.text, 80)}`, color: 'violet' });
  if (withMessages) for (const message of state.messages) out.push({ id: message.id, sessionId: message.fromSessionId, atMs: Date.parse(message.sentAt), glyph: '›', kind: 'message', label: `Message: ${clip(message.text, 80)}`, color: 'cyan' });
  return out;
}

function ticksFor(window: TimelineViewModel['window']): { at: number; label: string }[] {
  const steps = [60_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 14_400_000];
  const step = steps.find(candidate => window.spanMs / candidate <= 8) ?? steps[steps.length - 1];
  const first = Math.ceil(window.start / step) * step;
  const out: { at: number; label: string }[] = [];
  for (let at = first; at <= window.end; at += step) out.push({ at: fraction(at, window), label: clock(new Date(at).toISOString()) });
  return out;
}

export function buildTimeline(state: ConsoleState, context: TimelineContext = {}): TimelineViewModel {
  const window = windowFor(state, context);
  const markers = rawMarkers(state, context.messages ?? false).filter(marker => marker.atMs >= window.start && marker.atMs <= window.end);
  const showSubagents = context.subagents ?? true;
  const groups = new Map<string, TimelineGroup>();
  for (const session of state.sessions.filter(item => showSubagents || item.role !== 'subagent')) {
    const group = groups.get(session.repositoryId) ?? { id: session.repositoryId, name: repositoryName(state, session.repositoryId), rows: [] };
    group.rows.push({
      id: session.id, label: clean(session.name), laneId: session.laneId, depth: session.role === 'subagent' ? 1 : 0, badge: badge(displayStatus(state, session)),
      spans: spansFor(session, window),
      markers: markers.filter(marker => marker.sessionId === session.id).map(({ atMs, ...rest }) => ({ ...rest, at: fraction(atMs, window), time: clock(new Date(atMs).toISOString()) })),
    });
    groups.set(session.repositoryId, group);
  }
  const list = [...groups.values()];
  return { groups: list, order: list.flatMap(group => group.rows.map(row => row.id)), window, ticks: ticksFor(window), legend, empty: state.sessions.length === 0 };
}
