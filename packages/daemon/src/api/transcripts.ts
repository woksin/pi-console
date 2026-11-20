import type { Transcript } from '@pi-console/contract';

/**
 * Seam for transcript pages. The P2 adapters own reading session files into v1 transcript entries; until that reader
 * lands the daemon serves empty pages, and `around` finds no entry. Readers redact at read time (docs/security.md).
 */
export interface TranscriptReader {
  /** Entries with cursor > `after`, ascending, at most `limit`. */
  page(sessionId: string, after: number, limit: number): Transcript;
  /** A window of `limit` entries centred on `entryId`, or undefined when the entry is unknown. */
  around(sessionId: string, entryId: string, limit: number): Transcript | undefined;
}

export const noTranscripts: TranscriptReader = {
  page: (_sessionId, after) => ({ items: [], nextCursor: after, hasMore: false }),
  around: () => undefined,
};
