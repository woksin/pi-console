import { edgeKey, type State, type Session } from './model.ts';

export type Window = { start: number; span: number };
export function zoom(window: Window, factor: number): Window {
  const span = Math.max(5000, Math.min(3600000, window.span * factor));
  return { start: window.start + (window.span - span) / 2, span };
}
export const pan = (window: Window, direction: number): Window => ({ ...window, start: window.start + window.span * .15 * direction });
export const column = (at: number, window: Window, width: number) => Math.round((at - window.start) / window.span * (width - 1));
export type Marker = { id: string; sessionId: string; at: number; glyph: string; kind: string; text: string; color: 'blue' | 'green' | 'pink' | 'amber' | 'cyan' | 'violet' };
export function markers(state: State): Marker[] {
  const result: Marker[] = [];
  for (const r of state.requests) {
    const origin = r.origin === 'human' ? 'Human request' : r.origin === 'launch' ? 'Initial prompt' : 'Unproven origin';
    result.push({ id: r.id, sessionId: r.sessionId, at: Date.parse(r.createdAt), glyph: r.status === 'interrupted' ? '╳' : '◆', kind: `${origin} · ${r.status}`, text: r.text, color: r.status === 'interrupted' ? 'pink' : 'blue' });
    if (r.answer) result.push({ id: `${r.id}:answer`, sessionId: r.sessionId, at: Date.parse(r.answer.at), glyph: '●', kind: 'Final answer', text: r.answer.text, color: 'green' });
    for (const [i, answer] of r.interimAnswers.entries()) result.push({ id: `${r.id}:partial:${i}`, sessionId: r.sessionId, at: Date.parse(answer.at), glyph: '◐', kind: 'Partial answer · not final', text: answer.text, color: 'amber' });
  }
  for (const r of state.resets) result.push({ id: r.id, sessionId: r.sessionId, at: Date.parse(r.at), glyph: '┃', kind: r.kind, text: `Carried ${r.carriedRequestIds.join(', ')} · interrupted ${r.interruptedRequestIds.join(', ')}`, color: 'pink' });
  for (const q of state.questions) result.push({ id: q.id, sessionId: q.sessionId, at: Date.parse(q.createdAt), glyph: '?', kind: `Question · ${q.status}`, text: q.text, color: 'amber' });
  for (const m of state.messages) {
    result.push({ id: `${m.id}:sent`, sessionId: m.fromSessionId, at: Date.parse(m.sentAt), glyph: '›', kind: `Message sent → ${m.toSessionId}`, text: m.text, color: 'cyan' });
    result.push({ id: `${m.id}:received`, sessionId: m.toSessionId, at: Date.parse(m.sentAt), glyph: '‹', kind: `Message ${m.status} ← ${m.fromSessionId}`, text: m.text, color: 'violet' });
  }
  return result.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
export type GraphSelection = { kind: 'node'; id: string } | { kind: 'edge'; id: string };
export function graphEdges(state: State, sessions: Session[]) {
  const ids = new Set(sessions.map(s => s.id));
  const pairs = new Map<string, { id: string; from: string; to: string; count: number }>();
  for (const m of state.messages) {
    if (!ids.has(m.fromSessionId) || !ids.has(m.toSessionId)) continue;
    const id = edgeKey(m.fromSessionId, m.toSessionId);
    pairs.set(id, { id, from: m.fromSessionId, to: m.toSessionId, count: state.volumes.get(id) ?? 1 });
  }
  return [...pairs.values()];
}
export function graphMessages(state: State, selection: GraphSelection) {
  return state.messages.filter(m => selection.kind === 'node'
    ? m.fromSessionId === selection.id || m.toSessionId === selection.id
    : edgeKey(m.fromSessionId, m.toSessionId) === selection.id).toSorted((a, b) => b.sentAt.localeCompare(a.sentAt));
}
export function selectGraph(items: GraphSelection[], current: GraphSelection, delta: number) {
  const index = items.findIndex(item => item.kind === current.kind && item.id === current.id);
  return items[(Math.max(0, index) + delta + items.length) % items.length] ?? current;
}
export const modes = ['steer', 'followUp', 'nextTurn', 'abort', 'answer'] as const;
export type Mode = typeof modes[number];
export type InterventionInput = { type: Mode; sessionId: string; text?: string; questionId?: string; confirmation?: string };
export function interventionInput(session: Session, mode: Mode, text: string, questionId?: string, confirmation = ''): InterventionInput {
  if (mode === 'abort' && confirmation !== session.laneId) throw new Error(`Type ${session.laneId} to confirm abort.`);
  if (mode !== 'abort' && !text.trim()) throw new Error('Write a message before submitting.');
  if (text.length > 10000) throw new Error('Message exceeds 10,000 characters.');
  if (mode === 'answer' && !questionId) throw new Error('No open question belongs to this session.');
  return { type: mode, sessionId: session.id, ...(mode === 'abort' ? { confirmation } : { text }), ...(mode === 'answer' ? { questionId } : {}) };
}
