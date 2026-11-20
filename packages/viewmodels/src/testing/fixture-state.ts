import { generate, needsYou } from '@pi-console/testkit';
import type { Event as ApiEvent, Overview, TranscriptEntry } from '@pi-console/contract';
import { applyEvent } from '../state/reduce.ts';
import { emptyState, type ConsoleState } from '../state/state.ts';

/** The shared fixture as the state a client holds after its first snapshot. Used by view-model goldens in web and TUI. */
export function fixtureState(): ConsoleState {
  const { fixture } = generate();
  const { transcript, ...rest } = fixture;
  const snapshot: ApiEvent = {
    seq: 1, type: 'snapshot', occurredAt: fixture.generatedAt,
    payload: { ...rest, version: 0, transcriptCursors: [], interventions: [] } as never,
  };
  const state = applyEvent(emptyState(), snapshot);
  const sparkline: Overview['sparkline'] = fixture.sessions[0].samples.map((sample, index) => ({
    at: sample.at, contextPercent: sample.contextPercent,
    tokens: fixture.sessions.reduce((sum, session) => sum + session.samples[index].tokens, 0),
    costUsd: fixture.sessions.reduce((sum, session) => sum + session.samples[index].costUsd, 0),
  }));
  const transcripts: ConsoleState['transcripts'] = {};
  for (const entry of transcript as TranscriptEntry[]) (transcripts[entry.sessionId] ??= []).push(entry);
  return {
    ...state, connection: 'live', transcripts, needsYou: needsYou(fixture).items,
    overview: { counts: { sessions: fixture.sessions.length, repositories: fixture.repositories.length, byStatus: {} as never }, needsYou: [], sparkline },
    health: { daemon: 'mock', sources: 1, ingestLagSeconds: 2 },
  };
}
