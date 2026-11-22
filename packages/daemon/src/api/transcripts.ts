import type { Transcript } from '@pi-console/contract';

/**
 * Injectable seam for transcript pages. Production reads checkpoint-backed session files on demand.
 * Readers redact at read time (docs/security.md); unavailable sources have empty pages and no anchor.
 */
export interface TranscriptReader {
  /** Entries with cursor > `after`, ascending, at most `limit`. */
  page(sessionId: string, after: number, limit: number): Transcript | Promise<Transcript>;
  /** A window of `limit` entries centred on `entryId`, or undefined when the entry is unknown. */
  around(sessionId: string, entryId: string, limit: number): Transcript | undefined | Promise<Transcript | undefined>;
}

export const noTranscripts: TranscriptReader = {
  page: (_sessionId, after) => ({ items: [], nextCursor: after, hasMore: false }),
  around: () => undefined,
};
