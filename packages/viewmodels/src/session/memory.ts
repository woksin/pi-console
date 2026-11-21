import type { MemoryItem, SessionMemory } from '@pi-console/contract';
import { age, clip, sanitize } from '../format/format.ts';

export interface MemoryPanelInput { memory: SessionMemory | null; items: readonly MemoryItem[]; now: number }
export interface MemoryPanelItem {
  id: string; kind: MemoryItem['kind']; scope: string; status: MemoryItem['status']; statusLabel: string; text: string;
  /** The exact text a human runs in a pi session; the console never runs it. */
  command: string | null; rejectCommand: string | null; sourceNote: string;
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

export const memoryHint = 'Confirming needs an interactive pi session (a confirmation dialog); the console is read-only and cannot confirm or reject.';
const statuses: readonly MemoryItem['status'][] = ['active', 'proposed', 'done', 'superseded', 'withdrawn', 'rejected'];
const sources: Record<MemoryItem['sourceType'], string> = {
  user_message: 'from a user message', coordinator_order: 'from a coordinator order', agent_decision: 'from an agent decision', question_item: 'from a question',
};
const withheldText = '[withheld: secret-shaped content]';

function statusLabel(item: MemoryItem): string {
  return item.statusBasis === 'assumed' ? `${item.status} (assumed)` : item.status;
}

function unresolvedText(memory: SessionMemory): string {
  const last = memory.unresolved.atLastHandoff;
  const lower = `${String(memory.unresolved.lowerBound)}+ (lower bound)`;
  return last ? `unresolved: ${lower} · last handoff: ${String(last.count)}` : `unresolved: ${lower} · last handoff: unknown`;
}

function itemOf(item: MemoryItem): MemoryPanelItem {
  return {
    id: item.id, kind: item.kind, scope: `${item.scope.kind}:${sanitize(item.scope.key)}`, status: item.status, statusLabel: statusLabel(item),
    text: item.withheld ? withheldText : sanitize(item.text), command: item.command === null ? null : sanitize(item.command),
    rejectCommand: item.command === null ? null : `/memory reject ${sanitize(item.id)}`, sourceNote: sources[item.sourceType],
  };
}

function handoffText(handoff: SessionMemory['handoffs'][number]): string {
  const index = handoff.memoryIndex;
  if (handoff.degraded) return 'memory degraded at handoff';
  return index ? `${String(index.items)} items · ${String(index.unresolved)} unresolved · ${String(index.proposed)} proposed` : 'no memory figures';
}

/** The session memory panel shared by both clients: counts, items, the unresolved bound and the handoff figures. */
export function memoryPanelViewModel(input: MemoryPanelInput): MemoryPanelViewModel {
  const { memory, items, now } = input;
  const available = memory?.storeDetected === true;
  return {
    title: 'Memory', available,
    counts: memory ? statuses.map(status => ({ status, label: status, count: memory.counts[status] })) : [],
    unresolved: { text: memory ? unresolvedText(memory) : '' },
    items: items.map(itemOf),
    handoffs: (memory?.handoffs ?? []).map(handoff => ({ id: clip(sanitize(handoff.handoffId), 40), age: age(handoff.at, now), text: handoffText(handoff) })),
    hint: memoryHint,
  };
}
