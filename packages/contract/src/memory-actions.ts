import { bool, int, nullable, oneOf, strict, str, type Schema } from './schema-dsl.ts';
import { validate } from './validate.ts';

/** Mirrors pi-context-budget f0033fe, src/memory/review-bridge.ts (memory-review/v1). No producer imports. */
export const reviewPrefix = 'context-budget:memory-review/v1:';
export const reviewReasons = ['applied', 'conflict', 'rejected', 'unavailable', 'unsupported_version', 'invalid_request', 'wrong_target', 'handoff', 'no_source', 'not_proposed', 'not_human', 'expired', 'cancelled', 'duplicate', 'busy', 'refused', 'stale'] as const;
export const reviewId: Schema = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' };
const version = { const: 1 };
const action = oneOf('confirm', 'reject');
const reason = oneOf(...reviewReasons);
export const memoryActionRequestSchema = strict({ requestId: reviewId, itemId: reviewId, action });
export const reviewRequestSchema = strict({ requestId: reviewId, itemId: reviewId, action, sessionId: reviewId, generation: reviewId, expiresAt: { ...int, maximum: Number.MAX_SAFE_INTEGER } });
export const reviewReadinessSchema = strict({ version, available: bool, storeId: { type: 'string', maxLength: 64 }, sessionId: reviewId, generation: reviewId, reason }, ['version', 'available', 'storeId']);
export const reviewResultSchema = strict({ version, requestId: reviewId, itemId: reviewId, action, sessionId: reviewId, generation: reviewId, reason, ok: bool, status: oneOf('applied', 'conflict', 'rejected'), eventId: reviewId, winningEventId: reviewId }, ['version', 'requestId', 'reason']);
export const memoryActionStateSchema = oneOf('awaiting-human', 'awaiting-ingestion', 'observed-applied', 'declined', 'conflict', 'unavailable', 'expired', 'unknown');
export const memoryActionAvailabilitySchema = strict({ version, available: bool, generation: nullable(reviewId), reason: oneOf('available', 'disabled', 'unavailable') });
export const memoryActionReceiptSchema = strict({ version, requestId: reviewId, itemId: reviewId, action, sessionId: reviewId, generation: reviewId, connectionGeneration: reviewId, tokenId: str, createdAt: int, expiresAt: int, updatedAt: int, state: memoryActionStateSchema, reason: nullable(reason), eventId: nullable(reviewId) });

export interface MemoryActionRequest { requestId: string; itemId: string; action: 'confirm' | 'reject' }
export interface ReviewRequest extends MemoryActionRequest { sessionId: string; generation: string; expiresAt: number }
export type ReviewReason = typeof reviewReasons[number];
export interface ReviewReadiness { version: 1; available: boolean; storeId: string; sessionId?: string; generation?: string; reason?: ReviewReason }
export interface ReviewResult { version: 1; requestId: string; reason: ReviewReason; itemId?: string; action?: 'confirm' | 'reject'; sessionId?: string; generation?: string; ok?: boolean; status?: 'applied' | 'conflict' | 'rejected'; eventId?: string; winningEventId?: string }
export interface ChannelBinding { sessionId: string; pid: number; cwd: string }
export const bindingSchema = strict({ sessionId: reviewId, pid: { ...int, minimum: 1 }, cwd: { type: 'string', minLength: 1, maxLength: 4096 } });
const nonce = { type: 'string', minLength: 64, maxLength: 64 };
export const channelSchemas: Record<string, Schema> = {
  challenge: strict({ type: { const: 'challenge' }, nonce, generation: reviewId }),
  hello: strict({ type: { const: 'hello' }, nonce, binding: bindingSchema, proof: nonce }),
  welcome: strict({ type: { const: 'welcome' }, proof: nonce }),
  readiness: strict({ type: { const: 'readiness' }, value: reviewReadinessSchema }),
  request: strict({ type: { const: 'request' }, value: reviewRequestSchema }),
  cancel: strict({ type: { const: 'cancel' }, requestId: reviewId }),
  result: strict({ type: { const: 'result' }, value: reviewResultSchema }),
};
export type ChannelFrame = { type: 'challenge'; nonce: string; generation: string } | { type: 'hello'; nonce: string; binding: ChannelBinding; proof: string } | { type: 'welcome'; proof: string } | { type: 'readiness'; value: ReviewReadiness } | { type: 'request'; value: ReviewRequest } | { type: 'cancel'; requestId: string } | { type: 'result'; value: ReviewResult };
export const maxReviewFrameBytes = 16 * 1024;
export function identifier(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value); }

/** The schema validator's small subset does not implement `pattern`; enforce protocol identifiers explicitly. */
export function reviewValue(value: unknown, schema: Schema): unknown {
  validate(value, schema);
  const row = value as Record<string, unknown>;
  for (const key of ['requestId', 'itemId', 'sessionId', 'generation', 'eventId', 'winningEventId']) {
    if (Object.hasOwn(row, key) && !identifier(row[key])) throw new Error('Invalid review identifier');
  }
  return value;
}
export function parseChannelFrame(text: string): ChannelFrame {
  if (Buffer.byteLength(text) > maxReviewFrameBytes) throw new Error('Frame too large');
  const value: unknown = JSON.parse(text);
  const type = frameType(value);
  const schema = Object.hasOwn(channelSchemas, type) ? channelSchemas[type] : undefined;
  if (!schema) throw new Error('Invalid frame');
  const frame = reviewValue(value, schema) as ChannelFrame;
  if ('value' in frame) reviewValue(frame.value, {});
  if (frame.type === 'hello') reviewValue(frame.binding, bindingSchema);
  return frame;
}
function frameType(value: unknown): string {
  if (value === null || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string') throw new Error('Invalid frame');
  return value.type;
}
