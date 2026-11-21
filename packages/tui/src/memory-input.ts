import { memoryPanelViewModel, resolve, type Action } from '@pi-console/viewmodels';
import { sessionSideWidth, terminalContentWidth } from './state/session-layout.ts';
import type { UiState } from './state/ui.ts';
import type { Data } from './store/store.ts';

export type RequestMemoryAction = (sessionId: string, itemId: string, action: 'confirm' | 'reject') => void;
interface MemoryContext { sessionId: string; data: Data; request?: RequestMemoryAction }

/** Memory keys apply only to the visible memory pane, outside text capture/overlays. */
export function memoryInput(ui: UiState, key: string, data: Data, width: number, request?: RequestMemoryAction): UiState | null {
  if (!ui.sessionId) return null;
  if (!memoryVisible(ui, width)) return null;
  const action = resolve('memory', key);
  if (!action?.startsWith('memory.')) return null;
  return memoryAction(ui, action, { sessionId: ui.sessionId, data, request });
}

function memoryAction(ui: UiState, action: Action, context: MemoryContext): UiState {
  const items = context.data.memoryItems.get(context.sessionId) ?? [];
  const index = Math.min(ui.memoryIndex, Math.max(0, items.length - 1));
  if (action === 'memory.next') return { ...ui, memoryIndex: Math.max(0, Math.min(items.length - 1, index + 1)) };
  if (action === 'memory.previous') return { ...ui, memoryIndex: Math.max(0, index - 1) };
  requestSelected(context, index, action);
  return ui;
}
function requestSelected(context: MemoryContext, index: number, action: Action): void {
  const item = memoryPanel(context).items[index];
  if (item?.canRequest && context.request) context.request(context.sessionId, item.id, action === 'memory.confirm' ? 'confirm' : 'reject');
}
function memoryVisible(ui: UiState, width: number): boolean {
  if (ui.overlay !== 'none') return false;
  return ui.pane === 'memory' && sessionSideWidth(terminalContentWidth(width)) > 0;
}
function memoryPanel({ sessionId, data }: MemoryContext): ReturnType<typeof memoryPanelViewModel> {
  return memoryPanelViewModel({ memory: data.memory.get(sessionId) ?? null, items: data.memoryItems.get(sessionId) ?? [], now: 0, review: data.memoryReviews.get(sessionId) });
}
