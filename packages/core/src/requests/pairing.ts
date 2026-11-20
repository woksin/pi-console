import type { RequestEvidence } from '@pi-console/contract';
import type { AnswerModel, RequestModel } from '../projections/requests.ts';
import { passThroughFields, type AnswerObservation, type Observation, type PromptObservation, type SessionFacts } from './model.ts';
import { classifyOrigin } from './origin.ts';

const evidence = (kind: RequestEvidence['kind'], observation: Observation, resetId: string | null = null): RequestEvidence =>
  ({ kind, entryId: observation.entryId, resetId, at: observation.at });

interface Pending { request: RequestModel; key: string; resetsSince: number }

/** Walks one session's sorted observations; `pending` are the requests asked since the last answer or abort. */
class Pairing {
  readonly requests: RequestModel[] = [];
  #pending: Pending[] = [];
  /** Requests whose final answer is the most recent answer, until a prompt arrives (contract v1.2 section 10.3). */
  #lastAnswered: RequestModel[] = [];

  readonly sessionId: string;
  readonly facts: SessionFacts;

  constructor(sessionId: string, facts: SessionFacts) {
    this.sessionId = sessionId;
    this.facts = facts;
  }

  prompt(observation: PromptObservation): void {
    const request: RequestModel = {
      id: observation.requestId, sessionId: this.sessionId, text: observation.text,
      ...passThroughFields(), ...classifyOrigin(this.requests.length === 0, this.facts),
      status: 'open', createdAt: observation.at, resetId: null, answer: null, interimAnswers: [], ref: observation.ref,
      withheld: observation.withheld, answerWithheld: false, answerPossiblyUnseen: false, uncertainReason: null,
      evidence: [evidence('prompt', observation)], derivedFrom: observation.derivedFrom,
    };
    for (const earlier of this.#pending) earlier.request.evidence?.push(evidence('later-prompt', observation));
    this.requests.push(request);
    this.#pending.push({ request, key: observation.key, resetsSince: 0 });
    this.#lastAnswered = [];
  }

  /**
   * An answer closes every pending request (it is the answer to whatever was open when it started). Sharing one answer
   * is uncertain; so is an older request that a reset separated from the newest prompt, as the summary may have lost
   * it. An answer with nothing pending supersedes the previous answer, which becomes interim.
   */
  answer(observation: AnswerObservation): void {
    const answer: AnswerModel = { id: observation.answerId, text: observation.text, at: observation.at, interim: false };
    if (this.#pending.length === 0) {
      for (const request of this.#lastAnswered) supersede(request, answer, observation);
      return;
    }
    const newest = this.#pending.at(-1)?.resetsSince ?? 0;
    for (const { request, resetsSince } of this.#pending) {
      close(request, answer, observation);
      if (resetsSince > newest) request.uncertainReason = 'reset-then-new-prompt';
      else if (this.#pending.length > 1) request.uncertainReason ??= 'shared-answer';
    }
    this.#lastAnswered = this.#pending.map(item => item.request);
    this.#pending = [];
  }

  abort(observation: Observation): void {
    for (const { request } of this.#pending) {
      request.status = 'interrupted';
      request.evidence?.push(evidence('abort', observation));
    }
    this.#pending = [];
    this.#lastAnswered = [];
  }

  /**
   * A reset cuts off what is pending (`interrupted`, contract v1.2 section 10: open and listed at a boundary) but does
   * not close it: a later answer still pairs. Right after an answer, with no prompt between, it may hide that answer.
   */
  reset(observation: Observation & { resetId: string }): void {
    for (const pending of this.#pending) {
      pending.resetsSince += 1;
      pending.request.status = 'interrupted';
      pending.request.resetId = observation.resetId;
      pending.request.evidence?.push(evidence('reset', observation, observation.resetId));
    }
    for (const request of this.#lastAnswered) {
      request.answerPossiblyUnseen = true;
      request.evidence?.push(evidence('boundary', observation, observation.resetId));
    }
    this.#lastAnswered = [];
  }

  end(observation: Observation): void {
    for (const { request } of this.#pending) {
      request.status = 'unanswered';
      request.evidence?.push(evidence('session-end', observation));
    }
    this.#pending = [];
  }
}

function close(request: RequestModel, answer: AnswerModel, observation: AnswerObservation): void {
  Object.assign(request, { status: 'answered', answer, answerWithheld: observation.withheld });
  request.evidence?.push(evidence('answer', observation));
}

function supersede(request: RequestModel, answer: AnswerModel, observation: AnswerObservation): void {
  if (request.answer) request.interimAnswers.push({ ...request.answer, interim: true });
  request.answer = answer;
  request.answerWithheld = observation.withheld;
  request.evidence?.push(evidence('answer', observation));
}

/** Pairs a session's raw observations (sorted by key) into requests. Pure: same observations, same requests. */
export function pairSession(sessionId: string, facts: SessionFacts, observations: readonly Observation[]): RequestModel[] {
  const pairing = new Pairing(sessionId, facts);
  for (const observation of observations) {
    switch (observation.kind) {
      case 'prompt': pairing.prompt(observation); break;
      case 'answer': pairing.answer(observation); break;
      case 'abort': pairing.abort(observation); break;
      case 'reset': pairing.reset(observation); break;
      case 'end': pairing.end(observation); break;
    }
  }
  return pairing.requests;
}
