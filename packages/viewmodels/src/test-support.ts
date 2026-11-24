// Spec helpers only; not exported from the package index.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { generate, needsYou } from '@pi-console/testkit';
import type { Job, Message, Question, Request, Reset, Session, TranscriptEntry } from '@pi-console/contract';

export const now = Date.parse('2026-11-20T12:00:00.000Z');
/** The generated fixture is untyped JSON; the typed view below is checked against the schemas by the testkit's own specs. */
export interface TypedFixture {
  repositories: { id: string; name: string }[]; sessions: Session[]; requests: Request[]; questions: Question[];
  messages: Message[]; jobs: Job[]; resets: Reset[]; transcript: TranscriptEntry[];
}
export const fixture = generate().fixture as unknown as TypedFixture;
export const attention = needsYou(generate().fixture).items;

/**
 * Golden view-model snapshot shared by both clients: the TUI specs read the same files. Regenerate deliberately with
 * UPDATE_GOLDEN=1; a missing file is created once.
 */
export function golden(view: string, value: unknown, name = 'golden.json'): void {
  const path = fileURLToPath(new URL(`./${view}/${name}`, import.meta.url));
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (process.env.UPDATE_GOLDEN || !existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    return;
  }
  assert.equal(text, readFileSync(path, 'utf8'), `golden ${view}/${name} differs; rerun with UPDATE_GOLDEN=1 if the change is intended`);
}
