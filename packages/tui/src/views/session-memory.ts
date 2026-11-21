import { wrap, type MemoryPanelViewModel } from '@pi-console/viewmodels';
import type { Line } from '../view/renderer.ts';
import { blank, fit, t } from '../view/parts.ts';

/**
 * Lines of the read-only memory pane. A proposed item shows the exact `/memory confirm <id>` text for a human to run in a
 * pi session; no key in this view does anything but read.
 */
export function memoryLines(panel: MemoryPanelViewModel, inner: number): Line[] {
  if (!panel.available) return [[t('No intent-memory store seen for this session.', 'faint')]];
  const counts = panel.counts.filter(cell => cell.count > 0).map(cell => `${String(cell.count)} ${cell.label}`).join(' · ');
  return [
    fit([t(counts || 'no items', 'muted')], inner), fit([t(panel.unresolved.text, 'muted')], inner), blank,
    ...panel.items.flatMap((item): Line[] => [
      fit([t(`${item.kind} · ${item.statusLabel}`, 'amber'), t(` · ${item.scope}`, 'faint')], inner),
      ...wrap(item.text, inner - 2, 3).map((text): Line => [t(`  ${text}`, 'text')]),
      ...(item.command ? [[t('  Run in a pi session:', 'muted')] as Line, [t(`  ${item.command}`, 'cyan')] as Line, [t(`  ${item.rejectCommand ?? ''}`, 'cyan')] as Line] : []),
    ]),
    ...panel.handoffs.map(handoff => fit([t(`handoff ${handoff.id} · ${handoff.age} ago · ${handoff.text}`, 'faint')], inner)),
    blank, ...wrap(panel.hint, inner, 4).map((text): Line => [t(text, 'faint')]),
  ];
}
