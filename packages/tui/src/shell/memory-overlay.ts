import { sessionLabels, memoryPanelViewModel, type TextWidth } from '@pi-console/viewmodels';
import { Lines, Overlay, Panel, h, useTextWidth } from '../view/renderer.ts';
import { blank, t } from '../view/parts.ts';
import type { UiState } from '../state/ui.ts';
import type { Data } from '../store/store.ts';
import { memoryDocument } from '../views/memory.ts';
import { frame } from './overlays.ts';

interface Size { width: number; height: number }
type MemoryData = Pick<Data, 'sessions' | 'memory' | 'memoryItems' | 'memoryReviews' | 'memoryHistory'>;
interface MemoryView { data: MemoryData; sessionId: string | null; index: number; now: number }

/** The viewer fills the terminal: the usual two-cell margin, then a border, a blank row and a hint row. */
const boxOf = (size: Size) => frame(size.width, size.height, size);

/** The selected item's complete text, the scrollable range and the item's requestability. Shared by drawing and by key handling. */
export function memoryViewport(size: Size, view: MemoryView, measure: TextWidth) {
  const box = boxOf(size);
  const id = view.sessionId ?? '';
  const panel = memoryPanelViewModel({ memory: view.data.memory.get(id) ?? null, items: view.data.memoryItems.get(id) ?? [], now: view.now, review: view.data.memoryReviews.get(id), sessionNames: new Map(view.data.sessions.map(session => [session.id, sessionLabels(session)])) });
  const index = Math.max(0, Math.min(view.index, panel.items.length - 1));
  const lines = memoryDocument(panel, { width: box.width - 4, measure }, index, view.data.memoryHistory.get(id));
  const page = Math.max(1, box.height - 4);
  return { box, lines, requestable: panel.items[index]?.canRequest ?? false, bounds: { page, max: Math.max(0, lines.length - page) } };
}

const positionOf = (shown: { start: number; page: number; total: number }): string =>
  shown.total > shown.page ? `${String(shown.start + 1)}–${String(Math.min(shown.total, shown.start + shown.page))} of ${String(shown.total)} · ` : '';

/** The full-width Memory view of the open session: the selected item, wrapped and scrollable at every terminal width. */
export function MemoryViewer(props: { ui: UiState; data: MemoryData; now: number; size: Size }) {
  const measure = useTextWidth();
  const view = memoryViewport(props.size, { data: props.data, sessionId: props.ui.sessionId, index: props.ui.memoryIndex, now: props.now }, measure);
  const start = Math.max(0, Math.min(props.ui.memoryScroll, view.bounds.max));
  const right = `${positionOf({ start, page: view.bounds.page, total: view.lines.length })}esc closes`;
  const keys = `[/] prev/next · ↑↓ PgUp/PgDn Home/End scroll${view.requestable ? ' · c/x request review in pi' : ''}`;
  return h(Overlay, view.box, h(Panel, { title: 'Memory', right, focused: true, grow: 1, background: 'raised' },
    h(Lines, { lines: view.lines.slice(start, start + view.bounds.page), grow: 1 }),
    h(Lines, { lines: [blank, [t(keys, 'faint')]], height: 2 })));
}
