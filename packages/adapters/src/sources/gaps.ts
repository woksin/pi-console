import type { Mapper } from '../tailing/events.ts';

/** Raw job output and review prose are not lifecycle evidence (S10, S13). */
export const opaqueLogMapper: Mapper = () => [];
