import { glyphs, timeDisplay, wrap, type TextWidth, type TranscriptLine } from '@pi-console/viewmodels';
import { Lines, Overlay, Panel, h, useTextWidth, type Line } from '../view/renderer.ts';
import { blank, t } from '../view/parts.ts';
import type { UiState } from '../state/ui.ts';
import { entryDocument } from '../views/entry.ts';
import { frame } from './overlays.ts';

interface Size { width: number; height: number }
interface EntryView { entries: readonly TranscriptLine[]; entryKey: number | null; search: string }

const gone: Line[] = [[t('This entry is no longer in the loaded transcript window.', 'muted')]];

/** The viewer's size: wide and tall, with a title row, a footer row and the panel border. */
const boxOf = (size: Size) => frame(size.width, size.height, { width: 120, height: size.height });

function footerOf(entry: TranscriptLine | undefined, search: string, match: number | null): Line {
  if (!entry) return [t('')];
  if (search) return [t(match === null ? `No match for “${search}” in this entry.` : `First match of “${search}” highlighted.`, 'faint')];
  return [t(entry.tool?.truncated ? 'The daemon truncated this result before it reached the console.' : '', 'faint')];
}

/** The wrapped content, the scrollable range and the first match, for the entry the viewer shows. Shared by drawing and by key handling. */
export function entryViewport(size: Size, view: EntryView, measure: TextWidth) {
  const box = boxOf(size);
  const entry = view.entries.find(item => item.key === view.entryKey);
  const document = entry ? entryDocument(entry, { width: box.width - 4, search: view.search, measure }) : { lines: gone, match: null };
  const meta = entry ? wrap(timeDisplay(entry.at).absolute, box.width - 4, Infinity, measure).map((text): Line => [t(text, 'faint')]) : [];
  const page = Math.max(1, box.height - 4 - meta.length);
  const max = Math.max(0, document.lines.length - page);
  const start = document.match === null ? 0 : Math.min(max, Math.max(0, document.match - 2));
  return { entry, box, meta, lines: document.lines, match: document.match, bounds: { page, max, start } };
}

const positionOf = (shown: { start: number; page: number; total: number }): string =>
  shown.total > shown.page ? `${String(shown.start + 1)}–${String(Math.min(shown.total, shown.start + shown.page))} of ${String(shown.total)} · ↑↓ PgUp/PgDn Home/End · ` : '';

/** The complete selected transcript entry, wrapped to the box and scrollable; the search match is highlighted and scrolled into view. */
export function EntryViewer(props: { ui: UiState; entries: readonly TranscriptLine[]; size: Size }) {
  const measure = useTextWidth();
  const view = entryViewport(props.size, { entries: props.entries, entryKey: props.ui.entryKey, search: props.ui.search }, measure);
  const start = Math.max(0, Math.min(props.ui.entryScroll ?? view.bounds.start, view.bounds.max));
  const title = view.entry ? `${view.entry.time} ${glyphs[view.entry.kind]} ${view.entry.label}` : 'Entry';
  const right = `${positionOf({ start, page: view.bounds.page, total: view.lines.length })}esc closes`;
  return h(Overlay, view.box, h(Panel, { title, right, focused: true, grow: 1, background: 'raised' },
    ...(view.meta.length ? [h(Lines, { lines: view.meta, height: view.meta.length })] : []),
    h(Lines, { lines: view.lines.slice(start, start + view.bounds.page), grow: 1 }),
    h(Lines, { lines: [blank, footerOf(view.entry, props.ui.search, view.match)], height: 2 })));
}
