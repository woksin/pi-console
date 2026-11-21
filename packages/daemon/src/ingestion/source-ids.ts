/** Checkpoint ids of the non-session sources (the ids the catalogue and the mappers use). */
export const sourceIds = ['context-budget', 'lane-messages', 'lane-heartbeats', 'question-store', 'issue-work', 'intent-memory', 'phase-ledger'] as const;
export type SourceId = (typeof sourceIds)[number];
