import { markDirty, projection } from '../projector/handlers.ts';

export interface MessageModel {
  id: string;
  from: string;
  /** Recipient lane, or `*` for a broadcast. */
  to: string;
  text: string;
  withheld: boolean;
  status: 'sent' | 'delivered' | 'read';
  sentAt: string;
}

export interface MessagesState { messages: Record<string, MessageModel> }

const rank = { sent: 0, delivered: 1, read: 2 } as const;

/** A receipt can arrive before its message (backfill); it waits in a placeholder with an empty `sentAt`. */
const placeholder = (id: string): MessageModel => ({ id, from: '', to: '', text: '', withheld: false, status: 'sent', sentAt: '' });

/** Status only moves forward, whatever order delivery and read receipts arrive in. */
const advance = (status: 'delivered' | 'read') => (state: MessagesState, payload: { messageId: string }) => {
  markDirty(state, 'messages', payload.messageId);
  const message = state.messages[payload.messageId] ??= placeholder(payload.messageId);
  if (rank[status] > rank[message.status]) message.status = status;
};

interface Sent { messageId: string; from: string; excerpt?: string; withheld?: boolean }

function send(state: MessagesState, payload: Sent, to: string, sentAt: string): void {
  markDirty(state, 'messages', payload.messageId);
  const status = (state.messages[payload.messageId] as MessageModel | undefined)?.status ?? 'sent';
  state.messages[payload.messageId] = {
    id: payload.messageId, from: payload.from, to, text: payload.excerpt ?? '', withheld: payload.withheld ?? false, status, sentAt,
  };
}

export const messagesProjection = projection<MessagesState>('messages', 2, () => ({ messages: {} }), {
  MessageSent(state, payload, event) { send(state, payload, payload.to, event.occurredAt); },
  BroadcastSent(state, payload, event) { send(state, payload, '*', event.occurredAt); },
  MessageDelivered: advance('delivered'),
  MessageRead: advance('read'),
}, ['messages']);
