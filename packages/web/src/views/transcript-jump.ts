import type { TranscriptLine } from '@pi-console/viewmodels';
import { useEffect, useRef } from 'react';

/** A jump names an entry id; the line holding it is addressed by its stable key (a streaming run keeps its first delta's key). */
export const focusKey = (lines: readonly TranscriptLine[], entryId: string | null): string | null => {
  const found = entryId === null ? undefined : lines.find(line => line.id === entryId);
  return found === undefined ? null : String(found.key);
};

/** Scrolls to the jump target once per target, after its line has loaded. */
export function useJumpOnce(lines: readonly TranscriptLine[], focusEntry: string | null, onJumped: () => void): void {
  const jumped = useRef<string | null>(null);
  useEffect(() => {
    const key = focusEntry && jumped.current !== focusEntry ? focusKey(lines, focusEntry) : null;
    const target = key === null ? null : document.getElementById(`line-${key}`);
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    jumped.current = focusEntry;
    onJumped();
  }, [lines, focusEntry, onJumped]);
}
