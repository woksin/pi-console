// Shared showcase edits. Media keeps its pinned clock; only the interactive demo shifts timestamps.
import { recordQuestionHistory } from './questions.ts';

/** The mock memory store's own handoff clock; showcase item ages are written relative to it, then both clocks move together. */
export const memoryClock = '2026-07-01T10:30:00.000Z';

/** Realistic wording and age (minutes before the clock) for each mock item. The newest proposal leads; the withheld rejection is the oldest. Status, kind, source and withheld state stay the mock's own. */
const memoryShowcase = {
  'item-2': { text: 'Keep retry checkpoints before acknowledging the batch', minutes: 4 },
  'item-3': { text: 'Ask for approval before changing the retry policy', minutes: 18 },
  'item-1': { text: 'Keep the checkpoint history bounded, but retain completed checkpoint metadata', minutes: 42 },
  'item-4': { text: 'Record the worker queue depth before each migration checkpoint', minutes: 95 },
  'item-5': { text: 'Retry a failed checkpoint up to five times', minutes: 130 },
  'item-6': { text: 'Skip the cache warm-up before the first checkpoint', minutes: 170 },
  'item-7': { minutes: 220 },
  'item-8': { text: 'Prefer small, reviewable changes in every session', minutes: 280 },
};

/** Decorate a store-local copy in place: co-locate memory with the transcript, then give it believable copy, recent ages and newest-first order. */
export function decorateMemory(memory) {
  for (const item of memory) if (item.sessionId === 's1') {
    item.sessionId = 's2';
    item.scope = { kind: 'session', key: 's2' };
  }
  for (const item of memory) {
    const { text, minutes } = memoryShowcase[item.id] ?? {};
    if (minutes === undefined) continue;
    if (text !== undefined) item.text = text;
    item.at = new Date(Date.parse(memoryClock) - minutes * 60000).toISOString();
  }
  memory.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** A decorated, independent copy of the mock memory aligned to `now`; the module-global store is never touched. */
export function showcaseMemory(source, now) {
  const memory = source.map(item => ({ ...item }));
  decorateMemory(memory);
  return rebase(memory, Date.parse(now) - Date.parse(memoryClock));
}

/** Decorate the shared memory copy and give the expanded gallery question its history and long options. */
export function prepareShowcase(fixture, memory) {
  decorateMemory(memory);
  const question = fixture.questions[0];
  question.text += '\n\nKeep the cache bounded while preserving enough history to inspect a completed checkpoint. The selected window must apply consistently to the worker queue and its retry budget.\n\nWhich option should the coordinator use before the next migration checkpoint?';
  question.options = question.options.map(option => `${option} — retain completed checkpoint metadata for this window, then expire the cache entries without changing pending decisions or the worker retry budget.`);
  recordQuestionHistory(fixture.questions);
}

/** Shift every ISO clock together, preserving relative ages, nested history and transcript spacing. */
export function rebase(value, offset) {
  if (Array.isArray(value)) return value.map(item => rebase(item, offset));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rebase(item, offset)]));
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(value)) return new Date(Date.parse(value) + offset).toISOString();
  return value;
}
