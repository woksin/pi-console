import type { generate } from '../fixture/generate.ts';

type Fixture = ReturnType<typeof generate>['fixture'];
type FixtureRequest = Fixture['requests'][number];

/**
 * MOCK of the derived request fields (API v1: state evidence, pointers, uncertain labels, withheld text) so web and TUI can
 * render every Requests label before the daemon serves them. Additive: the generated fixture and its goldens are untouched.
 * The real derivation lives in core (`packages/core/src/requests`).
 */
const labelled: Record<string, Partial<Record<string, unknown>>> = {
  r1: { uncertain: true, uncertainReason: 'reset-then-new-prompt' },
  r4: { answerPossiblyUnseen: true },
  r6: { text: '[withheld]', withheld: true },
  r8: { uncertain: true, uncertainReason: 'shared-answer' },
};

function evidenceFor(fixture: Fixture, request: FixtureRequest, entryId: string | null) {
  const at = request.createdAt;
  const prompt = { kind: 'prompt', entryId, resetId: null, at };
  if (request.resetId) return [prompt, { kind: 'reset', entryId: null, resetId: request.resetId, at }];
  return request.answer ? [prompt, { kind: 'answer', entryId: null, resetId: null, at: request.answer.at }] : [prompt];
}

export function derivedRequest(fixture: Fixture, request: FixtureRequest) {
  const entry = fixture.transcript.find(item => item.sessionId === request.sessionId && item.requestId === request.id);
  const entryId = entry?.id ?? null;
  return {
    ...request, withheld: false, answerWithheld: false, answerPossiblyUnseen: false, uncertain: false, uncertainReason: null,
    derivedFrom: 'session-jsonl', evidence: evidenceFor(fixture, request, entryId),
    pointer: entry ? { sessionId: request.sessionId, entryId: entry.id, fileOffset: entry.cursor * 128 } : null,
    ...labelled[request.id],
  };
}

/** The fixture's requests with the derived fields added, by id. */
export const deriveRequests = (fixture: Fixture) => fixture.requests.map(request => derivedRequest(fixture, request));
