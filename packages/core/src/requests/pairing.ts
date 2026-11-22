import type { RequestEvidence } from '@pi-console/contract';
import type { AnswerModel, RequestModel } from '../projections/requests.ts';
import { passThroughFields, type AnswerObservation, type Observation, type PromptObservation, type SessionFacts } from './model.ts';
import { classifyOrigin } from './origin.ts';

const evidence = (kind: RequestEvidence['kind'], observation: Observation, resetId: string | null = null): RequestEvidence =>
  ({ kind, entryId: observation.entryId, resetId, at: observation.at });

interface Waiting { request: RequestModel; resetsSince: number }

/**
 * Walks one session's sorted observations through the state machine of docs/requests.md ("State machine"). Two sets
 * carry the state: `waiting` (asked, not yet closed by an answer, abort or session end) and `lastAnswered` (the requests
 * whose final answer is the most recent answer: the supersession window, closed only by a prompt or an abort).
 */
export class Pairing {
  readonly requests: RequestModel[] = [];
  #changed = new Set<RequestModel>();
  #waiting: Waiting[] = [];
  #lastAnswered: RequestModel[] = [];

  readonly sessionId: string;
  readonly facts: SessionFacts;

  constructor(sessionId: string, facts: SessionFacts) {
    this.sessionId = sessionId;
    this.facts = facts;
  }

  /** Continues the state machine, reporting only requests whose output this observation can change. */
  apply(observation: Observation): ReadonlySet<RequestModel> {
    this.#changed = new Set();
    switch (observation.kind) {
      case 'prompt': this.prompt(observation); break;
      case 'answer': this.answer(observation); break;
      case 'abort': this.abort(observation); break;
      case 'reset': this.reset(observation); break;
      case 'end': this.end(observation); break;
    }
    return this.#changed;
  }

  /** Opens a request. The previous answer counts as seen, so the supersession window closes. */
  prompt(observation: PromptObservation): void {
    const request: RequestModel = {
      id: observation.requestId, sessionId: this.sessionId, text: observation.text,
      ...passThroughFields(), ...classifyOrigin(this.requests.length === 0, this.facts),
      status: 'open', createdAt: observation.at, resetId: null, answer: null, interimAnswers: [], ref: observation.ref,
      withheld: observation.withheld, answerWithheld: false, answerPossiblyUnseen: false, uncertainReason: null,
      evidence: [evidence('prompt', observation)], derivedFrom: observation.derivedFrom,
    };
    for (const earlier of this.#waiting) {
      earlier.request.evidence?.push(evidence('later-prompt', observation));
      this.#changed.add(earlier.request);
    }
    this.#changed.add(request);
    this.requests.push(request);
    this.#waiting.push({ request, resetsSince: 0 });
    this.#lastAnswered = [];
  }

  /**
   * Closes every waiting request (it answers whatever was open when it started); with nothing waiting it supersedes the
   * final answer of the last answered requests, resets in between included. Sharing one answer is uncertain; so is an
   * older request that a reset separated from the newest prompt, as the summary may have lost it.
   */
  answer(observation: AnswerObservation): void {
    const answer: AnswerModel = { id: observation.answerId, text: observation.text, at: observation.at, interim: false };
    if (this.#waiting.length === 0) {
      for (const request of this.#lastAnswered) {
        supersede(request, answer, observation);
        this.#changed.add(request);
      }
      return;
    }
    const newest = this.#waiting.at(-1)?.resetsSince ?? 0;
    for (const { request, resetsSince } of this.#waiting) {
      close(request, answer, observation);
      this.#changed.add(request);
      if (resetsSince > newest) request.uncertainReason = 'reset-then-new-prompt';
      else if (this.#waiting.length > 1) request.uncertainReason ??= 'shared-answer';
    }
    this.#lastAnswered = this.#waiting.map(item => item.request);
    this.#waiting = [];
  }

  /** An abort ends the run: waiting requests are interrupted and the window closes (the user acted after the answer). */
  abort(observation: Observation): void {
    for (const { request } of this.#waiting) {
      request.status = 'interrupted';
      request.evidence?.push(evidence('abort', observation));
      this.#changed.add(request);
    }
    this.#waiting = [];
    this.#lastAnswered = [];
  }

  /**
   * A reset cuts off what is waiting (`interrupted`, contract v1.2 section 10) but does not close it: a later answer
   * still pairs. It may hide the final answer of the last answered requests (possibly unseen); the window stays open, so
   * a later answer still supersedes and takes the flag off (it belonged to the answer that became interim).
   */
  reset(observation: Observation & { resetId: string }): void {
    for (const waiting of this.#waiting) {
      waiting.resetsSince += 1;
      Object.assign(waiting.request, { status: 'interrupted', resetId: observation.resetId });
      waiting.request.evidence?.push(evidence('reset', observation, observation.resetId));
      this.#changed.add(waiting.request);
    }
    for (const request of this.#lastAnswered) {
      request.answerPossiblyUnseen = true;
      request.evidence?.push(evidence('boundary', observation, observation.resetId));
      this.#changed.add(request);
    }
  }

  /** Waiting requests stop waiting: still `open` ones become `unanswered`, ones cut off by a reset stay `interrupted`. */
  end(observation: Observation): void {
    for (const { request } of this.#waiting) {
      if (request.status === 'open') request.status = 'unanswered';
      request.evidence?.push(evidence('session-end', observation));
      this.#changed.add(request);
    }
    this.#waiting = [];
  }
}

function close(request: RequestModel, answer: AnswerModel, observation: AnswerObservation): void {
  Object.assign(request, { status: 'answered', answer, answerWithheld: observation.withheld });
  request.evidence?.push(evidence('answer', observation));
}

function supersede(request: RequestModel, answer: AnswerModel, observation: AnswerObservation): void {
  if (request.answer) request.interimAnswers.push({ ...request.answer, interim: true });
  Object.assign(request, { answer, answerWithheld: observation.withheld, answerPossiblyUnseen: false });
  request.evidence?.push(evidence('answer', observation));
}

/** Pairs a session's raw observations (sorted by key) into requests. Pure: same observations, same requests. */
export function pairSession(sessionId: string, facts: SessionFacts, observations: readonly Observation[]): RequestModel[] {
  const pairing = new Pairing(sessionId, facts);
  for (const observation of observations) pairing.apply(observation);
  return pairing.requests;
}
