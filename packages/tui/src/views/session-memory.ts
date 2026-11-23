import { wrap, type MemoryPanelViewModel } from '@pi-console/viewmodels';
import type { Line } from '../view/renderer.ts';
import type { MemoryHistory } from '../store/store.ts';
import { blank, fit, t, type CellBudget } from '../view/parts.ts';

function selectionLines(panel: MemoryPanelViewModel, selected: number | undefined, inner: number): Line[] {
  if (selected === undefined || panel.items.length === 0) return [];
  const index = Math.max(0, Math.min(selected, panel.items.length - 1));
  const lines = [fit([t(`[ ] item ${String(index + 1)} of ${String(panel.items.length)}`, 'cyan')], inner)];
  if (panel.items[index].canRequest) lines.push([t('c Confirm… · x Reject…', 'cyan')]);
  return lines;
}

function historyLines(progress: MemoryHistory | undefined, loaded: number, inner: number): Line[] {
  if (!progress) return [];
  const count = `${String(loaded)}/${progress.total === undefined ? '?' : String(progress.total)} loaded`;
  const lines: Line[] = [fit([t(`${count}${progress.more ? ' · more · ] older' : ''}`, 'faint')], inner)];
  if (progress.loading) lines.push([t('Loading older memory…', 'faint')]);
  if (progress.error) {
    const message = progress.error === 'more' ? 'Could not load older memory · r retry' : 'Could not refresh memory · r retry';
    lines.push(...wrap(message, inner).map((text): Line => [t(text, 'amber')]));
  }
  return lines;
}

/** Memory remains producer-owned. Keys only request a review in the owning interactive pi session. */
export function memoryLines(panel: MemoryPanelViewModel, budget: number | CellBudget, selected?: number, progress?: MemoryHistory): Line[] {
  const { width: inner, measure } = typeof budget === 'number' ? { width: budget } : budget;
  const history = historyLines(progress, panel.items.length, inner);
  if (!panel.available) return [...history, [t('No intent-memory store seen for this session.', 'faint')]];
  const counts = panel.counts.filter(cell => cell.count > 0).map(cell => `${String(cell.count)} ${cell.label}`).join(' · ');
  const index = Math.max(0, Math.min(selected ?? 0, panel.items.length - 1));
  const items = selected === undefined ? panel.items : panel.items.slice(index, index + 1);
  return [
    ...history,
    ...selectionLines(panel, selected, inner),
    fit([t(counts || 'no items', 'muted')], inner), fit([t(panel.unresolved.text, 'muted')], inner, undefined, measure), blank,
    ...items.flatMap((item): Line[] => [
      fit([t(`${item.kind} · ${item.statusLabel}`, 'amber'), t(` · ${item.scope}`, 'faint')], inner, undefined, measure),
      ...wrap(item.text, inner - 2, 3, measure).map((text): Line => [t(`  ${text}`, 'text')]),
      ...(item.review ? wrap(item.review.message, inner, 5, measure).map((text): Line => [t(text, 'amber')]) : []),
      ...(item.command ? [[t('  Run in a pi session:', 'muted')] as Line, [t(`  ${item.command}`, 'cyan')] as Line, [t(`  ${item.rejectCommand ?? ''}`, 'cyan')] as Line] : []),
    ]),
    ...panel.handoffs.map(handoff => fit([t(`handoff ${handoff.id} · ${handoff.age} ago · ${handoff.text}`, 'faint')], inner, undefined, measure)),
    blank, ...wrap(panel.hint, inner, 4, measure).map((text): Line => [t(text, 'faint')]),
  ];
}
