export { FileTailer, type TailerOptions, type PollResult } from './tailing/tailer.ts';
export { discover, sourcePath, pathDenied } from './tailing/paths.ts';
export { redact, scanPatterns, type Scanner, type RedactedText } from './tailing/redact.ts';
export type { Fact, Mapper } from './tailing/events.ts';
