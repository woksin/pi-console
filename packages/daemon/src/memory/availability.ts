import { identifier, type MemoryActionAvailability, type MemoryItem, type ReviewReadiness } from '@pi-console/contract';
import type { ReviewPeer } from './channel.ts';

type Reason = MemoryActionAvailability['reason'];
export function unavailableReview(reason: Reason): MemoryActionAvailability {
  return { version: 1, available: false, providerVersion: null, generation: null, reason };
}
function providerStatus(ready: ReviewReadiness): MemoryActionAvailability {
  return { version: 1, available: false, providerVersion: ready.version, generation: ready.generation ?? null, reason: 'not-ready' };
}
const unsupported = (ready: ReviewReadiness): boolean => ready.version !== 1 || ready.reason === 'unsupported_version';
const readyGeneration = (ready: ReviewReadiness): boolean => ready.available && identifier(ready.generation);
const boundProvider = (peer: ReviewPeer, ready: ReviewReadiness, storeId?: string): boolean => ready.sessionId === peer.binding.sessionId && ready.storeId === storeId;

/** Readiness comes only from the authenticated live provider, never transcript role metadata. */
export function providerAvailability(peer: ReviewPeer | undefined, storeId?: string): MemoryActionAvailability {
  if (!peer) return unavailableReview('offline');
  const ready = peer.readiness;
  if (!ready) return unavailableReview('unsupported');
  const value = providerStatus(ready);
  if (unsupported(ready)) return { ...value, reason: 'unsupported' };
  if (!readyGeneration(ready)) return value;
  if (!boundProvider(peer, ready, storeId)) return value;
  return { ...value, available: true, reason: 'available' };
}
export function reviewableItem(item: MemoryItem): boolean {
  return item.status === 'proposed' && item.statusBasis === 'recorded' && !item.withheld;
}
