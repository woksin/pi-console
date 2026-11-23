/** Checkpoint ids of the non-session sources (the ids the catalogue and the mappers use). */
export const sourceIds = ['context-budget', 'lane-messages', 'lane-heartbeats', 'question-store', 'issue-work', 'intent-memory', 'phase-ledger', 'github-closures'] as const;
/** Sources that start switched off: they reach the network, so they need an explicit opt-in. */
export const optInSources: readonly SourceId[] = ['github-closures'];
export type SourceId = (typeof sourceIds)[number];
