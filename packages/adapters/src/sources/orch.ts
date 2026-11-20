import type { Mapper } from '../tailing/events.ts';
import { excerpt, fact, object, text } from '../values.ts';

export const orchMapper: Mapper = value => {
  const row = object(value);
  if (row.msgId !== undefined) {
    if (!['acked', 'declined', 'done'].includes(text(row.state))) throw new Error('Unknown receipt state');
    if (row.state !== 'acked') return [];
    return []; // Acknowledged is not the contract's delivered or read observation.
  }
  if (row.createdAt !== undefined) {
    const messageId = text(row.id);
    return [fact('MessageSent', `message:${messageId}`, { messageId, from: text(row.from), to: text(row.to), ...excerpt(row.body) }, row.createdAt, messageId)];
  }
  if (row.sessionId !== undefined) {
    const sessionId = text(row.sessionId);
    return [fact('SessionHeartbeat', `session:${sessionId}`, { sessionId }, row.at, sessionId)];
  }
  throw new Error('Unknown orch record');
};
