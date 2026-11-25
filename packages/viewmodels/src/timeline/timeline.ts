import type { Message, Question, Request, Reset, Session, ThemeToken } from '@pi-console/contract';
import { sanitize, type TextWidth } from '../format/format.ts';
import { fitSessionLabel, sessionLabels } from '../format/session-labels.ts';
import { statusCell, type StatusCell } from '../format/status-cell.ts';
import { timelineTicks } from './ticks.ts';

export { timelineGroups, withoutRepositoryPrefix, type TimelineGroup } from './groups.ts';

export interface TimeWindow { start: number; span: number }
export interface Marker { id: string; sessionId: string; at: number; glyph: string; kind: string; text: string; color: ThemeToken; rank: number }
export interface TimelineCell { column: number; glyph: string; color: ThemeToken; markerId: string }
export interface TimelineLane { sessionId: string; label: string; status: StatusCell; cells: TimelineCell[] }
export interface TimelineViewModel {
  window: TimeWindow; lanes: TimelineLane[]; axis: { column: number; label: string }[]; markers: Marker[];
  legend: { glyph: string; color: ThemeToken; label: string }[];
}
export interface TimelineInput {
  sessions: readonly Session[]; requests: readonly Request[]; resets: readonly Reset[]; questions: readonly Question[]; messages: readonly Message[];
  window?: TimeWindow; width: number; labelWidth?: number; measure?: TextWidth;
}

const MIN_SPAN = 5_000;
const MAX_SPAN = 3_600_000;
export const zoom = (window: TimeWindow, factor: number): TimeWindow => {
  const span = Math.max(MIN_SPAN, Math.min(MAX_SPAN, window.span * factor));
  return { start: window.start + (window.span - span) / 2, span };
};
export const pan = (window: TimeWindow, direction: number): TimeWindow => ({ ...window, start: window.start + window.span * 0.15 * direction });

const time = (iso: string) => Date.parse(iso);

import { glyphs, markerLegend } from '../format/glyphs.ts';

function requestMarkers(requests: readonly Request[]): Marker[] {
  return requests.flatMap(request => {
    const interrupted = request.status === 'interrupted';
    const base = { sessionId: request.sessionId, rank: interrupted ? 5 : 4 };
    return [
      { ...base, id: request.id, at: time(request.createdAt), glyph: interrupted ? glyphs.interrupted : glyphs.request, kind: `${request.originLabel} · ${request.status}`, text: request.text, color: interrupted ? 'pink' : 'blue' } satisfies Marker,
      ...(request.answer ? [{ ...base, rank: 3, id: `${request.id}:answer`, at: time(request.answer.at), glyph: glyphs.answer, kind: 'Final answer', text: request.answer.text, color: 'green' } satisfies Marker] : []),
      ...request.interimAnswers.map((answer, index) => ({ ...base, rank: 2, id: `${request.id}:partial:${String(index)}`, at: time(answer.at), glyph: glyphs.partial, kind: 'Partial answer · not final', text: answer.text, color: 'amber' } satisfies Marker)),
    ];
  });
}

/** Everything that happened, as markers on a lane. Exact state intervals are not in the API, so none are drawn. */
export function markers(input: Omit<TimelineInput, 'window' | 'width'>): Marker[] {
  const resets = input.resets.map(reset => ({ id: reset.id, sessionId: reset.sessionId, at: time(reset.at), glyph: glyphs.reset, kind: `Reset · ${reset.kind}`, text: `carried ${reset.carriedRequestIds.join(', ') || 'none'} · interrupted ${reset.interruptedRequestIds.join(', ') || 'none'}`, color: 'pink', rank: 6 }) satisfies Marker);
  const questions = input.questions.map(question => ({ id: question.id, sessionId: question.sessionId, at: time(question.createdAt), glyph: glyphs.question, kind: `Question · ${question.status}`, text: question.text, color: 'amber', rank: 1 }) satisfies Marker);
  const messages = input.messages.map(message => ({ id: message.id, sessionId: message.fromSessionId, at: time(message.sentAt), glyph: glyphs.message, kind: `Message · ${message.status}`, text: message.text, color: 'cyan', rank: 0 }) satisfies Marker);
  return [...requestMarkers(input.requests), ...resets, ...questions, ...messages].map(marker => ({ ...marker, text: sanitize(marker.text) })).sort((a, b) => a.at - b.at);
}

export function fitWindow(all: readonly Marker[]): TimeWindow {
  if (all.length === 0) return { start: 0, span: MIN_SPAN };
  const start = all[0].at;
  return { start, span: Math.max(MIN_SPAN, all[all.length - 1].at - start) * 1.05 };
}

export const columnOf = (at: number, window: TimeWindow, width: number): number => Math.round((at - window.start) / window.span * (width - 1));

export function timelineViewModel(input: TimelineInput): TimelineViewModel {
  const all = markers(input);
  const window = input.window ?? fitWindow(all);
  const active = new Set(all.map(marker => marker.sessionId));
  const lanes = input.sessions.filter(session => active.has(session.id)).map(session => {
    const cells = new Map<number, TimelineCell & { rank: number }>();
    for (const marker of all.filter(item => item.sessionId === session.id)) {
      const column = columnOf(marker.at, window, input.width);
      if (column < 0 || column >= input.width) continue;
      const present = cells.get(column);
      if (!present || present.rank <= marker.rank) cells.set(column, { column, glyph: marker.glyph, color: marker.color, markerId: marker.id, rank: marker.rank });
    }
    return { sessionId: session.id, label: fitSessionLabel(sessionLabels(session), input.labelWidth ?? 22, input.measure), status: statusCell(session.status), cells: [...cells.values()].map(cell => ({ column: cell.column, glyph: cell.glyph, color: cell.color, markerId: cell.markerId })) };
  });
  const axis = timelineTicks(window, input.width).map(({ column, label }) => ({ column, label }));
  return { window, lanes, axis, markers: all, legend: [...markerLegend] };
}
