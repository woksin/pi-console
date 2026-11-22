import { markDirty } from '../projector/handlers.ts';
import type { RequestModel } from '../projections/requests.ts';
import type { DerivationState, ExplicitFacts, Observation, SessionRecord } from './model.ts';
import { Pairing } from './pairing.ts';
import { changeIndex } from './session-arrays.ts';

/** Own-property lookup: ingested ids must never resolve inherited names. */
export const find = <Item>(items: Record<string, Item>, id: string): Item | undefined => Object.hasOwn(items, id) ? items[id] : undefined;

/** Explicit facts win, but must not mutate the raw pairing machine's continuation state. */
function overlay(request: RequestModel, facts: ExplicitFacts | undefined): RequestModel {
  if (!facts) return request;
  const result = structuredClone(request);
  for (const { id, text, at, interim, withheld } of facts.answers) {
    const answer = { id, text, at, interim };
    if (answer.interim) result.interimAnswers.push(answer);
    else Object.assign(result, { answer, status: 'answered', answerWithheld: withheld });
  }
  if (facts.interruption && result.status !== 'answered') {
    result.status = 'interrupted';
    result.resetId = facts.interruption.resetId;
  }
  return result;
}

/** Reconstructible indexes, never serialized and never the sole source of a request fact. */
export class SessionRenderer {
  readonly #state: DerivationState;
  readonly #sessionId: string;
  readonly #record: SessionRecord;
  readonly #pairing: Pairing;
  readonly #raw = new Map<string, RequestModel>();
  readonly #entries = new Map<string, RequestModel[]>();
  readonly #stated = new Map<string, string | null>();
  readonly #claims = new Map<string, Set<string>>();
  #indices: Map<string, number>;
  readonly explicitIds: Set<string>;

  constructor(state: DerivationState, sessionId: string, record: SessionRecord) {
    this.#state = state;
    this.#sessionId = sessionId;
    this.#record = record;
    this.#pairing = new Pairing(sessionId, record.facts);
    for (const observation of record.observations) this.#pairing.apply(observation);
    for (const request of this.#pairing.requests) this.#indexRaw(request);
    this.explicitIds = new Set(record.explicitIds);
    for (const id of record.explicitIds) this.#claim(id, find(state.explicit, id));
    this.#indices = new Map(record.requestIds.map((id, index) => [id, index]));
  }

  #indexRaw(request: RequestModel): void {
    this.#raw.set(request.id, request);
    const entry = request.ref?.entryId ?? '';
    const requests = this.#entries.get(entry) ?? [];
    requests.push(request);
    this.#entries.set(entry, requests);
  }

  #ownsRequest(facts: ExplicitFacts | undefined): facts is ExplicitFacts & { request: RequestModel } {
    return facts?.request?.sessionId === this.#sessionId;
  }

  #claim(id: string, facts: ExplicitFacts | undefined): void {
    if (!this.#ownsRequest(facts)) return;
    this.#stated.set(id, facts.entryId);
    if (facts.entryId === null) return;
    const owners = this.#claims.get(facts.entryId) ?? new Set<string>();
    owners.add(id);
    this.#claims.set(facts.entryId, owners);
  }

  #unclaim(id: string): string | null | undefined {
    const previous = this.#stated.get(id);
    this.#stated.delete(id);
    if (previous === undefined || previous === null) return previous;
    const owners = this.#claims.get(previous);
    owners?.delete(id);
    if (owners?.size === 0) this.#claims.delete(previous);
    return previous;
  }

  #write(request: RequestModel): void {
    if (!this.#indices.has(request.id)) {
      const index = this.#record.requestIds.length;
      this.#indices.set(request.id, index);
      this.#record.requestIds.push(request.id);
      markDirty(this.#state, 'sessions', this.#sessionId);
      changeIndex(this.#record, 'requestIds', index);
    }
    this.#state.requests[request.id] = request;
    markDirty(this.#state, 'requests', request.id);
  }

  #drop(id: string): void {
    const index = this.#indices.get(id);
    if (index === undefined) return;
    const ids = this.#record.requestIds;
    const last = ids.pop();
    if (last === undefined) return;
    markDirty(this.#state, 'sessions', this.#sessionId);
    if (index < ids.length) {
      ids[index] = last;
      this.#indices.set(last, index);
      changeIndex(this.#record, 'requestIds', index);
    }
    this.#indices.delete(id);
    Reflect.deleteProperty(this.#state.requests, id);
    markDirty(this.#state, 'requests', id);
  }

  #isHidden(request: RequestModel, facts: ExplicitFacts | undefined): boolean {
    return Boolean(facts?.request) || this.#claims.has(request.ref?.entryId ?? '');
  }

  #writeRaw(request: RequestModel): void {
    const facts = find(this.#state.explicit, request.id);
    if (this.#ownsRequest(facts)) return;
    if (this.#isHidden(request, facts)) this.#drop(request.id);
    else this.#write(overlay(request, facts));
  }

  append(observation: Observation): void {
    const changed = this.#pairing.apply(observation);
    const newest = this.#pairing.requests.at(-1);
    if (observation.kind === 'prompt' && newest) this.#indexRaw(newest);
    for (const request of changed) this.#writeRaw(request);
  }

  #entryRequests(entry: string | null | undefined): RequestModel[] {
    if (entry === undefined || entry === null) return [];
    return this.#entries.get(entry) ?? [];
  }

  #refreshRaw(id: string, affected: Set<RequestModel>): void {
    const raw = this.#raw.get(id);
    if (raw) affected.add(raw);
    else this.#drop(id);
    for (const request of affected) this.#writeRaw(request);
  }

  #writeStated(facts: ExplicitFacts | undefined): void {
    if (this.#ownsRequest(facts)) this.#write(overlay(facts.request, facts));
  }

  /** Only a changed explicit request and the raw prompts it claims/releases need to be rendered. */
  refresh(id: string): void {
    const facts = find(this.#state.explicit, id);
    const previous = this.#unclaim(id);
    this.#claim(id, facts);
    const affected = new Set([...this.#entryRequests(previous), ...this.#entryRequests(this.#stated.get(id))]);
    this.#refreshRaw(id, affected);
    this.#writeStated(facts);
  }

  /** Late observations and changed lineage retain the original whole-session re-derivation semantics. */
  renderAll(): void {
    for (const id of this.#record.requestIds) {
      markDirty(this.#state, 'requests', id);
      Reflect.deleteProperty(this.#state.requests, id);
    }
    const derived = this.#pairing.requests.filter(request => !this.#isHidden(request, find(this.#state.explicit, request.id)));
    const stated = [...this.#stated.keys()].flatMap(id => find(this.#state.explicit, id)?.request ?? []);
    const requests = [...derived, ...stated].map(request => overlay(request, find(this.#state.explicit, request.id)));
    for (const request of requests) {
      markDirty(this.#state, 'requests', request.id);
      this.#state.requests[request.id] = request;
    }
    this.#record.requestIds = requests.map(request => request.id);
    markDirty(this.#state, 'sessions', this.#sessionId);
    this.#indices = new Map(this.#record.requestIds.map((id, index) => [id, index]));
  }
}
