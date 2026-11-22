import { memoryPanelViewModel, resolve, type Action } from '@pi-console/viewmodels';
import { sessionSideWidth, terminalContentWidth } from './state/session-layout.ts';
import type { UiState } from './state/ui.ts';
import type { Data } from './store/store.ts';

export type RequestMemoryAction = (sessionId: string, itemId: string, action: 'confirm' | 'reject') => void;
export interface MemoryCallbacks { request?: RequestMemoryAction; loadMore?: (sessionId: string) => void }
interface MemoryContext extends MemoryCallbacks { sessionId: string; data: Data }

/** Memory keys apply only to the visible memory pane, outside text capture/overlays. */
export function memoryInput(ui: UiState, key: string, data: Data, width: number, callbacks: RequestMemoryAction | MemoryCallbacks = {}): UiState | null {
  if (!ui.sessionId) return null;
  if (!memoryVisible(ui, width)) return null;
  const actions = typeof callbacks === 'function' ? { request: callbacks } : callbacks;
  const context = { sessionId: ui.sessionId, data, ...actions };
  if (retryMemory(key, context)) return ui;
  const action = resolve('memory', key);
  if (!action?.startsWith('memory.')) return null;
  return memoryAction(ui, action, context);
}

function memoryAction(ui: UiState, action: Action, context: MemoryContext): UiState {
  const { index, length } = memorySelection(ui, context);
  if (action === 'memory.next') {
    const next = Math.max(0, Math.min(length - 1, index + 1));
    if (next === Math.max(0, length - 1)) loadOlder(context);
    return { ...ui, memoryIndex: next };
  }
  if (action === 'memory.previous') return { ...ui, memoryIndex: Math.max(0, index - 1) };
  requestSelected(context, index, action);
  return ui;
}
function memorySelection(ui: UiState, { sessionId, data }: MemoryContext): { index: number; length: number } {
  const length = (data.memoryItems.get(sessionId) ?? []).length;
  return { length, index: Math.min(ui.memoryIndex, Math.max(0, length - 1)) };
}
function retryMemory(key: string, context: MemoryContext): boolean {
  if (key !== 'r') return false;
  if (!context.data.memoryHistory.get(context.sessionId)?.error) return false;
  loadOlder(context);
  return true;
}
function loadOlder(context: MemoryContext): void {
  const progress = context.data.memoryHistory.get(context.sessionId);
  if (!progress || progress.loading) return;
  if (progress.more || progress.error) context.loadMore?.(context.sessionId);
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
