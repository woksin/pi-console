import type { Mapper } from '../tailing/events.ts';
import { fact, integer, object, text } from '../values.ts';

const states = new Set(['in-progress', 'in-review', 'blocked', 'paused', 'done', 'unknown']);

export const issueMapper: Mapper = value => {
  const row = object(value);
  const issue = `${text(row.repo)}#${integer(row.issue)}`;
  if (row.state === undefined) return [];
  const status = text(row.state);
  if (!states.has(status)) throw new Error('Unknown issue state');
  return [fact('IssueStatusChanged', `issue:${issue}`, { issue, status }, row.ts, issue)];
};
