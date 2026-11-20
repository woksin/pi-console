import type { Fact, Mapper } from '../tailing/events.ts';
import { redact } from '../tailing/redact.ts';

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected string');
  if (!value) throw new Error('Expected string');
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (!value) throw new Error('Expected object');
  if (typeof value !== 'object') throw new Error('Expected object');
  if (Array.isArray(value)) throw new Error('Expected object');
  return value as Record<string, unknown>;
}

function excerpt(content: unknown): { excerpt: string; withheld: boolean } {
  const body = typeof content === 'string' ? content : contentText(content);
  const safe = redact(body);
  return { excerpt: safe.text ?? '[withheld]', withheld: safe.withheld };
}

function contentText(content: unknown): string {
  if (!Array.isArray(content)) throw new Error('Expected content');
  return (content as unknown[]).map(object).filter(block => block.type === 'text').map(block => text(block.text)).join('\n');
}

type Emit = (type: string, payload: Record<string, unknown>) => Fact[];

function assistantFacts(message: Record<string, unknown>, raw: Record<string, unknown>, emit: Emit): Fact[] {
  switch (message.stopReason) {
    case 'stop': return emit('AnswerObserved', {
      ...raw, answerId: `${text(raw.sessionId)}:${text(raw.entryId)}`, interim: false, ...excerpt(message.content),
    });
    case 'aborted': return emit('RequestInterrupted', { ...raw, reason: 'aborted' });
    case 'toolUse': case 'error': return [];
    default: throw new Error('Unknown assistant stop reason');
  }
}

function messageFacts(record: Record<string, unknown>, sessionId: string, emit: Emit): Fact[] {
  const message = object(record.message);
  const entryId = text(record.id);
  const raw = { raw: true, sessionId, entryId };
  if (message.role === 'user') return emit('RequestObserved', {
    ...raw, requestId: `${sessionId}:${entryId}`, origin: 'unproven', originEvidence: 'Transcript user role only; launch provenance not established', ...excerpt(message.content),
  });
  if (message.role === 'assistant') return assistantFacts(message, raw, emit);
  if (['system', 'toolResult', 'custom', 'bashExecution', 'branchSummary', 'compactionSummary'].includes(text(message.role))) return [];
  throw new Error('Unknown message role');
}

function sessionStarted(record: Record<string, unknown>, sessionId: string, emit: Emit): Fact[] {
  if (record.version !== 3) throw new Error('Unsupported session header');
  if (record.id !== sessionId) throw new Error('Unsupported session header');
  return emit('SessionStarted', { sessionId, cwd: text(record.cwd), model: null, role: 'main', parentSessionId: null });
}

/** No request state: raw answer/abort observations intentionally have no requestId. */
export function sessionMapper(sessionId: string): Mapper {
  const handlers: Partial<Record<string, (record: Record<string, unknown>, emit: Emit) => Fact[]>> = {
    session: (record, emit) => sessionStarted(record, sessionId, emit),
    message: (record, emit) => messageFacts(record, sessionId, emit),
    model_change: (record, emit) => emit('ModelChanged', { sessionId, model: `${text(record.provider)}/${text(record.modelId)}`, previousModel: null }),
    thinking_level_change: (record, emit) => emit('ThinkingLevelChanged', { sessionId, level: text(record.thinkingLevel) }),
    compaction: (record, emit) => emit('ResetOccurred', { sessionId, resetId: text(record.id), kind: 'compaction' }),
  };
  return record => {
    const entryId = text(record.id);
    const occurredAt = text(record.timestamp);
    const emit: Emit = (type, payload) => [{ type, subject: `session:${sessionId}`, entryId, occurredAt, payload }];
    if (['session_info', 'custom', 'custom_message', 'label', 'branch_summary'].includes(text(record.type))) return [];
    const handler = handlers[text(record.type)];
    if (!handler) throw new Error('Unknown session entry');
    return handler(record, emit);
  };
}
