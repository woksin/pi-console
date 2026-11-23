import { wrap, type MemoryPanelItem, type MemoryPanelViewModel, type TextWidth } from '@pi-console/viewmodels';
import type { Line } from '../view/renderer.ts';
import type { MemoryHistory } from '../store/store.ts';
import type { Color } from '../view/theme.ts';
import { blank, t } from '../view/parts.ts';
import { historyLines, itemHeadLines, selectionLines } from './session-memory.ts';

interface Layout { width: number; measure?: TextWidth }

const wrapped = (text: string, color: Color, { width, measure }: Layout, indent = ''): Line[] =>
  wrap(text, Math.max(1, width - indent.length), undefined, measure).map((row): Line => [t(`${indent}${row}`, color)]);

function itemLines(item: MemoryPanelItem, layout: Layout): Line[] {
  return [
    ...itemHeadLines(item, layout),
    ...(item.review ? wrapped(item.review.message, 'amber', layout) : []),
    ...(item.command ? [[t('  Run in a pi session:', 'muted')] as Line, ...wrapped(item.command, 'cyan', layout, '  '), ...(item.rejectCommand ? wrapped(item.rejectCommand, 'cyan', layout, '  ') : [])] : []),
  ];
}

/** The complete selected memory item and its context, wrapped to the width with no line cap. Consumes the sanitized view model only. */
export function memoryDocument(panel: MemoryPanelViewModel, layout: Layout, selected: number, progress?: MemoryHistory): Line[] {
  const history = historyLines(progress, panel.items.length, layout.width);
  if (!panel.available) return [...history, [t('No intent-memory store seen for this session.', 'faint')]];
  const counts = panel.counts.filter(cell => cell.count > 0).map(cell => `${String(cell.count)} ${cell.label}`).join(' · ');
  const item = panel.items[Math.max(0, Math.min(selected, panel.items.length - 1))] as MemoryPanelItem | undefined;
  return [
    ...history,
    ...selectionLines(panel, selected, layout.width),
    ...wrapped(counts || 'no items', 'muted', layout), ...wrapped(panel.unresolved.text, 'muted', layout), blank,
    ...(item ? itemLines(item, layout) : []),
    ...panel.handoffs.flatMap(handoff => wrapped(`handoff ${handoff.id} · ${handoff.age} ago · ${handoff.text}`, 'faint', layout)),
    blank, ...wrapped(panel.hint, 'faint', layout),
  ];
}
