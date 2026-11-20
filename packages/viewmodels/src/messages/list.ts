import type { Message } from '@pi-console/contract';
import { matches, parseFilter } from '../common/filter.ts';
import { age, clean, clip } from '../common/format.ts';
import { sessionLabel, type ConsoleState } from '../state/index.ts';

export interface DeliveryToken { status: Message['status']; glyph: string; label: string; color: 'faint' | 'amber' | 'green' }

const delivery: Record<Message['status'], DeliveryToken> = {
  sent: { status: 'sent', glyph: '○', label: 'Sent', color: 'faint' },
  delivered: { status: 'delivered', glyph: '◐', label: 'Delivered', color: 'amber' },
  read: { status: 'read', glyph: '●', label: 'Read', color: 'green' },
};

export const deliveryToken = (status: Message['status']): DeliveryToken => delivery[status];

export interface MessageRow { id: string; from: string; fromId: string; to: string; toId: string; text: string; delivery: DeliveryToken; age: string; at: string }

export interface MessageDetail extends MessageRow { verbatim: string }

export interface MessagesListViewModel { search: string; rows: MessageRow[]; selected: MessageDetail | null; total: number; empty: boolean }

export function messageRow(state: ConsoleState, message: Message): MessageRow {
  return {
    id: message.id, from: sessionLabel(state, message.fromSessionId), fromId: message.fromSessionId, to: sessionLabel(state, message.toSessionId),
    toId: message.toSessionId, text: clip(message.text, 160), delivery: delivery[message.status], age: age(state.liveAt, message.sentAt), at: message.sentAt,
  };
}

export function buildMessageList(state: ConsoleState, context: { search?: string; selectedId?: string | null } = {}): MessagesListViewModel {
  const search = context.search ?? '';
  const parsed = parseFilter(search);
  const visible = state.messages
    .filter(message => matches(parsed, `${message.text} ${sessionLabel(state, message.fromSessionId)} ${sessionLabel(state, message.toSessionId)}`, { status: message.status }))
    .toSorted((a, b) => b.sentAt.localeCompare(a.sentAt) || b.id.localeCompare(a.id));
  const chosen = visible.find(message => message.id === context.selectedId) ?? visible.at(0);
  return {
    search, rows: visible.map(message => messageRow(state, message)), total: state.messages.length, empty: state.messages.length === 0,
    selected: chosen ? { ...messageRow(state, chosen), verbatim: clean(chosen.text) } : null,
  };
}
