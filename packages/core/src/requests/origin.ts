import type { Origin, SessionFacts } from './model.ts';

export interface OriginClass { origin: Origin; originEvidence: string }

/**
 * Origin evidence texts (ADR-0008, contract v1.2 section 2): positive evidence or nothing, default deny. Session JSONL
 * never proves `human`; text (lane headers such as "[orch message from L0]", slash commands) proves nothing.
 */
export const originEvidence = {
  child: 'Prompt in a subagent session: written by the parent agent, never by you',
  parent: 'Session has a parent session (fork, handoff or relaunch): first prompt not proven a launch',
  parentUnknown: 'First prompt, but the source did not establish whether the session has a parent; not proven a launch',
  launch: 'First prompt of a session without a parent: classified as the initial prompt (command line or first typed)',
  later: 'Later prompt; session JSONL does not record whether it was typed, injected or queued',
} as const;

const unproven = (evidence: string): OriginClass => ({ origin: 'unproven', originEvidence: evidence });

/** A first prompt is a launch only when the session is known to be top level (no parent link, not a child). */
function firstPromptOrigin(facts: SessionFacts): OriginClass {
  if (facts.parentSessionId !== null) return unproven(originEvidence.parent);
  if (!facts.parentSessionKnown) return unproven(originEvidence.parentUnknown);
  return { origin: 'launch', originEvidence: originEvidence.launch };
}

/**
 * Classifies a raw prompt from session facts only, never from its text, and never as `human`: only the session's
 * first prompt can be proven, and only as a launch. Child-session prompts are never the user's.
 */
export function classifyOrigin(first: boolean, facts: SessionFacts): OriginClass {
  if (facts.child) return unproven(originEvidence.child);
  return first ? firstPromptOrigin(facts) : unproven(originEvidence.later);
}
