import type { Mapper } from '../tailing/events.ts';
import { fact, object, text } from '../values.ts';

const resets = new Map([['handoff_committed', 'handoff']]);
const observations = new Set(['turn', 'session_start', 'session_shutdown', 'handoff_written', 'status_pruned', 'soft_crossing', 'soft_model_notice', 'required_notice', 'blocked', 'handoff_lint', 'handoff_rejected', 'handoff_discarded', 'mode_mismatch', 'idle_handoff_requested', 'settle_handoff_requested', 'backstop', 'relaunch']);

/** Token counts and policy thresholds are not a context-window percentage. */
export const contextMapper: Mapper = value => {
  const row = object(value);
  const sessionId = text(row.sessionId);
  if (row.event === undefined) {
    text(row.phase);
    return []; // Status snapshot: no lifecycle, capacity or percent in this writer.
  }
  const event = text(row.event);
  const kind = resets.get(event);
  if (kind) {
    const resetId = text(row.path);
    return [fact('ResetOccurred', `session:${sessionId}`, { sessionId, resetId, kind }, row.at, resetId)];
  }
  if (observations.has(event)) return [];
  throw new Error('Unknown context event');
};
