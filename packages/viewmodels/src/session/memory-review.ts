import type { MemoryActionAvailability, MemoryActionReceipt } from '@pi-console/contract';
import { sanitize } from '../format/format.ts';

export interface MemoryReviewProgress { state: MemoryActionReceipt['state'] | 'requesting'; message: string }
export interface MemoryReviewSession {
  availability: MemoryActionAvailability | null;
  items: ReadonlyMap<string, MemoryReviewProgress>;
}
export const emptyMemoryReview = (): MemoryReviewSession => ({ availability: null, items: new Map() });
const fallback: Record<MemoryActionAvailability['reason'], string> = {
  available: 'Approve in pi: each request needs a human response in the owning interactive pi session.',
  disabled: 'Memory review is disabled. Run the command in an interactive pi session.',
  'read-only': 'This token is read-only. Connect with the memory-control token, or run the command in pi.',
  offline: 'The owning pi session is offline. Run the command when its interactive pi session is available.',
  unsupported: 'This provider does not support memory review v1. Use a compatible provider or run the command in pi.',
  'not-ready': 'The owning pi provider is not ready for review. Run the command in an interactive pi session.',
};
export function memoryReviewHint(availability: MemoryActionAvailability | null): string {
  return availability ? fallback[availability.reason] : 'Memory review is unavailable (daemon unsupported or disconnected). Run the command in pi.';
}
const labels: Record<MemoryReviewProgress['state'], string> = {
  requesting: 'Requesting review…',
  'awaiting-human': 'Awaiting confirmation in pi',
  'awaiting-ingestion': 'Pi reported approval; awaiting producer ingestion',
  'observed-applied': 'Producer change observed',
  declined: 'Review declined in pi',
  conflict: 'Review conflict: the item changed',
  unavailable: 'Review unavailable',
  expired: 'Review expired',
  unknown: 'Review outcome unknown; check pi before retrying',
};
export const memoryReviewPending = (state: MemoryReviewProgress['state']): boolean =>
  state === 'requesting' || state === 'awaiting-human' || state === 'awaiting-ingestion';
export function memoryReviewProgress(receipt: MemoryActionReceipt): MemoryReviewProgress {
  return { state: receipt.state, message: `${labels[receipt.state]}${receipt.reason ? ` (${sanitize(receipt.reason)})` : ''}` };
}
export const requestingMemoryReview = (): MemoryReviewProgress => ({ state: 'requesting', message: labels.requesting });
export const failedMemoryReview = (error: unknown): MemoryReviewProgress => ({
  state: 'unknown', message: `${labels.unknown}: ${sanitize(error instanceof Error ? error.message : 'Request failed').slice(0, 240)}`,
});
