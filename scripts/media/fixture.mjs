// Shared showcase edits. Media keeps its pinned clock; only the interactive demo shifts timestamps.
import { recordQuestionHistory } from './questions.ts';

/** Co-locate memory and transcript, and give the expanded gallery question its history and long options. */
export function prepareShowcase(fixture, memory) {
  for (const item of memory) if (item.sessionId === 's1') {
    item.sessionId = 's2';
    item.scope = { kind: 'session', key: 's2' };
  }
  const question = fixture.questions[0];
  question.text += '\n\nKeep the cache bounded while preserving enough history to inspect a completed checkpoint. The selected window must apply consistently to the worker queue and its retry budget.\n\nWhich option should the synthetic coordinator use before the next migration checkpoint?';
  question.options = question.options.map(option => `${option} — retain completed checkpoint metadata for this window, then expire the synthetic cache entries without changing pending decisions or the worker retry budget.`);
  recordQuestionHistory(fixture.questions);
}

/** Shift every ISO clock together, preserving relative ages, nested history and transcript spacing. */
export function rebase(value, offset) {
  if (Array.isArray(value)) return value.map(item => rebase(item, offset));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rebase(item, offset)]));
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(value)) return new Date(Date.parse(value) + offset).toISOString();
  return value;
}
