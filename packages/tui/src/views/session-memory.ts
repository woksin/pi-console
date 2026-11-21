import { wrap, type MemoryPanelViewModel } from '@pi-console/viewmodels';
import type { Line } from '../view/renderer.ts';
import { blank, fit, t } from '../view/parts.ts';

function selectionLines(panel: MemoryPanelViewModel, selected: number | undefined, inner: number): Line[] {
  if (selected === undefined || panel.items.length === 0) return [];
  const index = Math.max(0, Math.min(selected, panel.items.length - 1));
  const lines = [fit([t(`[ ] item ${String(index + 1)} of ${String(panel.items.length)}`, 'cyan')], inner)];
  if (panel.items[index].canRequest) lines.push([t('c Confirm… · x Reject…', 'cyan')]);
  return lines;
}

/** Memory remains producer-owned. Keys only request a review in the owning interactive pi session. */
export function memoryLines(panel: MemoryPanelViewModel, inner: number, selected?: number): Line[] {
  if (!panel.available) return [[t('No intent-memory store seen for this session.', 'faint')]];
  const counts = panel.counts.filter(cell => cell.count > 0).map(cell => `${String(cell.count)} ${cell.label}`).join(' · ');
  const index = Math.max(0, Math.min(selected ?? 0, panel.items.length - 1));
  const items = selected === undefined ? panel.items : panel.items.slice(index, index + 1);
  return [
    ...selectionLines(panel, selected, inner),
    fit([t(counts || 'no items', 'muted')], inner), fit([t(panel.unresolved.text, 'muted')], inner), blank,
    ...items.flatMap((item): Line[] => [
      fit([t(`${item.kind} · ${item.statusLabel}`, 'amber'), t(` · ${item.scope}`, 'faint')], inner),
      ...wrap(item.text, inner - 2, 3).map((text): Line => [t(`  ${text}`, 'text')]),
      ...(item.review ? wrap(item.review.message, inner, 5).map((text): Line => [t(text, 'amber')]) : []),
      ...(item.command ? [[t('  Run in a pi session:', 'muted')] as Line, [t(`  ${item.command}`, 'cyan')] as Line, [t(`  ${item.rejectCommand ?? ''}`, 'cyan')] as Line] : []),
    ]),
    ...panel.handoffs.map(handoff => fit([t(`handoff ${handoff.id} · ${handoff.age} ago · ${handoff.text}`, 'faint')], inner)),
    blank, ...wrap(panel.hint, inner, 4).map((text): Line => [t(text, 'faint')]),
  ];
}
