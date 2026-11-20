import type { Projector } from '../projector/projector.ts';
import type { AnyProjection } from '../projector/projection.ts';
import { burnProjection, type BurnState } from './burn.ts';
import { lanesProjection, type LanesState } from './lanes.ts';
import { messagesProjection, type MessagesState } from './messages.ts';
import { questionsProjection, type QuestionsState } from './questions.ts';
import { requestDerivation } from '../requests/derivation.ts';
import type { RequestDerivation, RequestsState } from './requests.ts';
import { sessionsProjection, type SessionsState } from './sessions.ts';
import { workProjection, type WorkState } from './work.ts';

/** Every M1 read model. `requests` is replaceable; the default is the request/answer derivation (docs/requests.md). */
export function consoleProjections(requests: RequestDerivation = requestDerivation): AnyProjection[] {
  return [sessionsProjection, burnProjection, lanesProjection, questionsProjection, messagesProjection, workProjection, requests] as AnyProjection[];
}

export interface ReadModels {
  sessions: SessionsState;
  burn: BurnState;
  lanes: LanesState;
  questions: QuestionsState;
  messages: MessagesState;
  work: WorkState;
  requests: RequestsState;
}

const names = ['sessions', 'burn', 'lanes', 'questions', 'messages', 'work', 'requests'] as const;

/** The current read models of a projector built from `consoleProjections()`. Read-only views of live state. */
export function readModels(projector: Projector): ReadModels {
  return Object.fromEntries(names.map(name => [name, projector.state(name)])) as unknown as ReadModels;
}
