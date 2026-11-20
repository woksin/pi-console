import type { Request } from '@pi-console/contract';
import { requestDetail, wrap, type Excerpt } from '@pi-console/viewmodels';
import type { Line } from '../../view/renderer.ts';
import { blank, heading, statusParts, t } from '../../view/parts.ts';
import type { Env } from '../common.ts';

const body = (lines: readonly string[], withheld: boolean, width: number, limit: number): Line[] =>
  lines.flatMap(text => wrap(text, width, limit)).slice(0, limit).map((text): Line => [t(text, withheld ? 'faint' : 'text', withheld ? { italic: true } : {})]);

const answerLines = (answer: Excerpt | null, lines: readonly string[], status: string, width: number): Line[] => (answer
  ? [[t('✓ final · ', 'green'), t(`${answer.age} ago`, 'faint')], ...body(lines, answer.withheld, width, 6)]
  : [[t(status === 'interrupted' ? 'No final answer: interrupted by a reset.' : 'No final answer recorded yet.', 'muted')]]);

/** The Provenance pane. Origin is a classification, said as such; every evidence entry says what it points at. */
export function requestDetailLines(request: Request | undefined | false, env: Env, paneWidth: number): Line[] {
  if (!request) return [[t('Select a request', 'faint')]];
  const detail = requestDetail({ request, sessions: env.data.sessions, now: env.now });
  const inner = paneWidth - 4;
  return [
    [...statusParts(detail.status, 0, true), t(`  ${detail.age} ago`, 'faint')],
    [t(detail.originLabel, detail.origin === 'human' ? 'blue' : 'amber', { bold: true })], [t(detail.provenance, 'faint', { italic: true })],
    ...wrap(detail.originEvidence, inner, 3).map((text): Line => [t(text, 'faint', { italic: true })]),
    ...(detail.uncertain ? [[t(`≈ ${detail.uncertain}`, 'amber')] as Line] : []),
    ...(detail.possiblyUnseen ? [[t('◌ The answer may have been lost at a reset.', 'amber')] as Line] : []),
    blank, heading('Request'), ...body(detail.textLines, detail.withheld, inner, 8), blank,
    heading('Answer'), ...answerLines(detail.answer, detail.answerLines, request.status, inner),
    ...detail.interim.flatMap((item): Line[] => [blank, [t('◐ partial answer, not final · ', 'amber'), t(`${item.age} ago`, 'faint')], ...body([item.text], false, inner, 4)]),
    blank, heading('Evidence'),
    ...detail.evidence.map((item): Line => [t(`${item.label} · ${item.age} ago`, 'muted'), ...(item.resetId ? [t(` ┃ reset ${item.resetId}`, 'pink')] : []), ...(item.transcript ? [t(' → transcript', 'cyan')] : [])]),
    ...(detail.transcript ? [blank, [t('⏎ opens the transcript at the prompt', 'cyan')] as Line] : []),
  ];
}
