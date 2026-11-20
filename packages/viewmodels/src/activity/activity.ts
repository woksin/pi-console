import type { Intervention } from '@pi-console/contract';
import { age, clip } from '../common/format.ts';
import { sessionLabel, type ConsoleState } from '../state/index.ts';

export interface ActivityRow { id: string; type: Intervention['type']; session: string; sessionId: string; text: string; actor: string; result: string; age: string }

export interface ActivityViewModel { rows: ActivityRow[]; empty: boolean; emptyText: string }

export function buildActivity(state: ConsoleState): ActivityViewModel {
  const rows = state.interventions.toReversed().map(item => ({
    id: item.id, type: item.type, session: sessionLabel(state, item.sessionId), sessionId: item.sessionId, text: clip(item.text, 160),
    actor: item.actor, result: item.result, age: age(state.liveAt, item.recordedAt),
  }));
  return { rows, empty: rows.length === 0, emptyText: 'No interventions recorded. The console is read-only in M1.' };
}
