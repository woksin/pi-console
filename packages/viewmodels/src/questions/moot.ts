import { assessMoot, type MootReason, type MootTarget, type Question } from '@pi-console/contract';
import { age, sanitize } from '../format/format.ts';

export const possiblyMootLabel = 'Possibly moot';

/** One inspectable linked target; every field is sanitized text. `current` is false for evidence past its hour. */
export interface MootEvidenceRow {
  key: string; target: string; kind: string; state: string; closedAt: string; source: string; fetchedAt: string; fetched: string; current: boolean;
  /** The whole row as one line, for narrow layouts. */
  text: string;
}
/** `label` is set only while every link is freshly observed closed or merged; the evidence is shown whenever any was observed. */
export interface QuestionMoot { label: string | null; explanation: string; evidence: MootEvidenceRow[] }

const explanations: Record<MootReason, string> = {
  moot: 'Every linked issue or pull request was observed closed or merged within the last hour. The question itself is still open: check before closing it.',
  'no-links': 'No links to check.',
  'unsupported-links': 'Not marked: some links are not recognised github.com issues or pull requests, so they cannot be checked.',
  open: 'Not marked: a linked issue or pull request was observed open.',
  unknown: 'Not marked: the state of a linked item could not be confirmed.',
  unverified: 'Not marked: a linked item has not been checked yet.',
  stale: 'Not marked: the evidence is more than an hour old, so it is shown as history only.',
};

const kindText = (kind: MootTarget['kind']): string => (kind === 'pull-request' ? 'pull request' : kind === 'issue' ? 'issue' : 'item');

function evidenceRow(target: MootTarget, now: number): MootEvidenceRow {
  const state = target.state === 'unverified' ? 'not checked' : target.state;
  const closedAt = target.closedAt ? sanitize(target.closedAt) : target.state === 'closed' || target.state === 'merged' ? 'unknown' : 'not closed';
  const fetchedAt = target.fetchedAt ? sanitize(target.fetchedAt) : '–';
  const fetched = target.fetchedAt ? `${age(target.fetchedAt, now)} ago` : 'never';
  const row = { key: target.target, target: sanitize(target.target), kind: kindText(target.kind), state, closedAt, source: sanitize(target.source ?? '–'), fetchedAt, fetched, current: target.fresh };
  const freshness = target.fetchedAt ? `${target.fresh ? 'fetched' : 'stale · fetched'} ${fetched}` : 'not fetched';
  return { ...row, text: `${row.target} · ${row.kind} ${state} · closed ${closedAt} · ${freshness} · ${row.source}` };
}

/** The shared advisory: pure over the question and the supplied clock, so a client expires it without any new event. */
export function questionMoot(question: Question, now: number): QuestionMoot | null {
  if (question.status !== 'open') return null;
  const evidence = question.linkEvidence;
  const result = assessMoot(question.links, evidence, now);
  if (!evidence?.length && !result.moot) return null;
  return { label: result.moot ? possiblyMootLabel : null, explanation: explanations[result.reason], evidence: result.targets.map(target => evidenceRow(target, now)) };
}
