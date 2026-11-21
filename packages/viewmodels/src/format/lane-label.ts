import { sanitize } from './format.ts';

/** A lane id is only unique within its repository. */
export function laneLabel(repository: string, lane: string): string {
  return `${sanitize(repository)}/${sanitize(lane)}`;
}
