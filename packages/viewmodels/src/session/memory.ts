import type { MemoryItem, SessionMemory, ThemeToken } from '@pi-console/contract';
import { age, clip, sanitize } from '../format/format.ts';
import { fitSessionLabel, type SessionLabel } from '../format/session-labels.ts';
import { emptyMemoryReview, memoryReviewHint, memoryReviewPending, memoryReviewRetryable, type MemoryReviewProgress, type MemoryReviewSession } from './memory-review.ts';

export interface MemoryPanelInput {
  memory: SessionMemory | null; items: readonly MemoryItem[]; now: number; review?: MemoryReviewSession;
  /** Optional session id → display identity; an id with no name falls back to a short id. */
  sessionNames?: ReadonlyMap<string, Pick<SessionLabel, 'name' | 'lane'>>;
  /** The session the panel is shown in: its own session scope is implied and left off item details. */
  currentSessionId?: string;
}
export interface MemoryPanelItem {
  id: string; kind: MemoryItem['kind']; scope: string; status: MemoryItem['status']; statusLabel: string;
  /** The status as a short badge: the label travels with the tone, so colour is never the only carrier. */
  badge: { label: string; tone: ThemeToken };
  text: string;
  /** The smaller second line: kind, scope, source and age. */
  details: string;
  /** The exact text a human runs in a pi session; the console never runs it. */
  command: string | null; rejectCommand: string | null; sourceNote: string;
  canRequest: boolean; review: MemoryReviewProgress | null;
}
export interface MemoryPanelViewModel {
  title: string;
  /** False until the summary is loaded or when no memory store has been seen. */
  available: boolean;
  counts: { status: MemoryItem['status']; label: string; count: number }[];
  unresolved: { text: string };
  items: MemoryPanelItem[];
  handoffs: { id: string; age: string; text: string }[];
  hint: string;
}

export const memoryHint = memoryReviewHint(null);
const statuses: readonly MemoryItem['status'][] = ['active', 'proposed', 'done', 'superseded', 'withdrawn', 'rejected'];
const sources: Record<MemoryItem['sourceType'], string> = {
  user_message: 'from a user message', coordinator_order: 'from a coordinator order', agent_decision: 'from an agent decision', question_item: 'from a question',
};
const badgeTones: Record<MemoryItem['status'], ThemeToken> = { active: 'green', proposed: 'amber', done: 'cyan', superseded: 'faint', withdrawn: 'muted', rejected: 'red' };
const withheldText = '[withheld: secret-shaped content]';

function statusLabel(item: MemoryItem): string {
  return item.statusBasis === 'assumed' ? `${item.status} (assumed)` : item.status;
}

/** The daemon counts human messages with neither a classification nor an item citation, independently of proposed items. */
function unresolvedText(memory: SessionMemory): string {
  const last = memory.unresolved.atLastHandoff;
  const found = memory.unresolved.lowerBound;
  const now = found === 0 ? '' : `At least ${String(found)} human ${found === 1 ? 'message' : 'messages'} not yet captured in memory`;
  const handoff = last ? `Unresolved messages at last handoff: ${String(last.count)}` : '';
  return [now, handoff].filter(Boolean).join(' · ');
}

const shortId = (id: string): string => clip(sanitize(id), 8);

function scopeLabel(item: MemoryItem, names: MemoryPanelInput['sessionNames']): string {
  const { kind, key } = item.scope;
  return kind === 'session' ? `session ${fitSessionLabel(names?.get(key) ?? { name: shortId(key), lane: '' }, 24)}` : `${kind}:${sanitize(key)}`;
}

function itemOf(item: MemoryItem, context: { review: MemoryReviewSession; busy: boolean; now: number; names?: MemoryPanelInput['sessionNames']; currentSessionId?: string }): MemoryPanelItem {
  const { review, busy } = context;
  const scope = scopeLabel(item, context.names);
  const implied = item.scope.kind === 'session' && item.scope.key === context.currentSessionId;
  return {
    id: item.id, kind: item.kind, scope, status: item.status, statusLabel: statusLabel(item),
    badge: { label: statusLabel(item), tone: badgeTones[item.status] },
    details: [item.kind, implied ? '' : scope, sources[item.sourceType], `${age(item.at, context.now)} ago`].filter(Boolean).join(' · '),
    text: item.withheld ? withheldText : sanitize(item.text), command: item.command === null ? null : sanitize(item.command),
    rejectCommand: item.command === null ? null : `/memory reject ${sanitize(item.id)}`, sourceNote: sources[item.sourceType],
    canRequest: requestable(item, review) && !busy && memoryReviewRetryable(review.items.get(item.id)), review: review.items.get(item.id) ?? null,
  };
}

function requestable(item: MemoryItem, review: MemoryReviewSession): boolean {
  return review.availability?.available === true && item.status === 'proposed' && item.statusBasis === 'recorded' && !item.withheld;
}

function handoffText(handoff: SessionMemory['handoffs'][number]): string {
  const index = handoff.memoryIndex;
  if (handoff.degraded) return 'memory degraded at handoff';
  return index ? `${String(index.items)} items · ${String(index.unresolved)} unresolved · ${String(index.proposed)} proposed` : 'no memory figures';
}

/** The session memory panel shared by both clients: counts, items, the unresolved bound and the handoff figures. */
export function memoryPanelViewModel(input: MemoryPanelInput): MemoryPanelViewModel {
  const { memory, items, now } = input;
  const review = input.review ?? emptyMemoryReview();
  const busy = [...review.items.values()].some(progress => memoryReviewPending(progress.state));
  const available = memory?.storeDetected === true;
  return {
    title: 'Memory', available,
    counts: memory ? statuses.map(status => ({ status, label: status, count: memory.counts[status] })) : [],
    unresolved: { text: memory ? unresolvedText(memory) : '' },
    items: items.map(item => itemOf(item, { review, busy, now, names: input.sessionNames, currentSessionId: input.currentSessionId })),
    handoffs: (memory?.handoffs ?? []).map(handoff => ({ id: clip(sanitize(handoff.handoffId), 40), age: age(handoff.at, now), text: handoffText(handoff) })),
    hint: memoryReviewHint(review.availability),
  };
}
