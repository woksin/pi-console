import type { Message, Session } from '@pi-console/contract';
import { age, clock, sanitize } from '../format/format.ts';

export interface MessageRow { id: string; from: string; to: string; fromSessionId: string; toSessionId: string; delivery: Message['status']; deliveryGlyph: string; text: string; age: string; time: string }
export interface MessagesViewModel { rows: MessageRow[] }

const glyph: Record<Message['status'], string> = { sent: '○', delivered: '◐', read: '●' };

/** Newest first. Delivery state is shown as a glyph and always as a word. */
export function messagesViewModel(input: { messages: readonly Message[]; sessions: readonly Session[]; now: number }): MessagesViewModel {
  const names = new Map(input.sessions.map(session => [session.id, session.laneId]));
  const rows = [...input.messages].sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt)).map(message => ({
    id: message.id, from: names.get(message.fromSessionId) ?? message.fromSessionId, to: names.get(message.toSessionId) ?? message.toSessionId,
    fromSessionId: message.fromSessionId, toSessionId: message.toSessionId, delivery: message.status, deliveryGlyph: glyph[message.status],
    text: sanitize(message.text), age: age(message.sentAt, input.now), time: clock(message.sentAt),
  }));
  return { rows };
}

/** The `/` filter: case-insensitive substring over the message text and both lane names (shared by the TUI and web). */
export const filterMessageRows = <T extends Pick<MessageRow, 'text' | 'from' | 'to'>>(rows: readonly T[], filter: string): T[] =>
  rows.filter(row => !filter || `${row.text} ${row.from} ${row.to}`.toLowerCase().includes(filter.toLowerCase()));
