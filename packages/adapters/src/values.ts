import { redact } from './tailing/redact.ts';
import type { Fact } from './tailing/events.ts';

export function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected string');
  if (!value) throw new Error('Expected string');
  return value;
}

export function object(value: unknown): Record<string, unknown> {
  if (!value) throw new Error('Expected object');
  if (typeof value !== 'object') throw new Error('Expected object');
  if (Array.isArray(value)) throw new Error('Expected object');
  return value as Record<string, unknown>;
}

export function list(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('Expected list');
  return (value as unknown[]).map(object);
}

export function integer(value: unknown): number {
  if (!Number.isSafeInteger(value)) throw new Error('Expected integer');
  return value as number;
}

export function timestamp(value: unknown): string {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result))) throw new Error('Expected timestamp');
  return result;
}

export function excerpt(value: unknown): { excerpt: string; withheld: boolean } {
  const body = typeof value === 'string' ? value : list(value).filter(block => block.type === 'text').map(block => text(block.text)).join('\n');
  const safe = redact(body);
  return { excerpt: safe.text ?? '[withheld]', withheld: safe.withheld };
}

export function fact(type: string, subject: string, payload: Record<string, unknown>, at: unknown, entryId: string): Fact {
  return { type, subject, payload, occurredAt: timestamp(at), entryId };
}
