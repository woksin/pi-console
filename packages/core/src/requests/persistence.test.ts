import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NewEvent } from '@pi-console/contract';
import { SqliteEventLog } from '../event-log/sqlite-event-log.ts';
import { canonicalJson } from '../projector/canonical.ts';
import { Projector } from '../projector/projector.ts';
import { SqliteProjectionStore } from '../projector/sqlite-projection-store.ts';
import { testEvent } from '../testing/events.ts';
import { requestDerivation } from './derivation.ts';
import type { DerivationState } from './model.ts';

class RestartFixture {
  #next = 0;
  readonly initial: NewEvent[];

  constructor(extraRequests: number) {
    this.initial = ['a', 'b'].map(sessionId => this.#fact('SessionStarted', {
      sessionId, cwd: '/fixture', model: null, role: 'main', parentSessionId: null, parentSessionKnown: true,
    }));
    for (let index = 0; index <= extraRequests; index++) this.initial.push(...this.#rawPair(index));
    for (const requestId of ['first', 'middle', 'last', 'raw-0']) this.initial.push(this.#stated({ requestId, sessionId: 'a' }));
  }

  #fact(type: string, payload: unknown): NewEvent { return testEvent(++this.#next, type, payload); }

  #stated(request: { requestId: string; sessionId: string }): NewEvent {
    return this.#fact('RequestObserved', { ...request, entryId: request.requestId, origin: 'human', originEvidence: 'explicit fixture', excerpt: request.requestId });
  }

  #rawPair(index: number): NewEvent[] {
    return [
      this.#fact('RequestObserved', { raw: true, sessionId: 'a', requestId: `raw-${index}`, entryId: `raw-${index}`, excerpt: `prompt ${index}`, origin: 'unproven', originEvidence: 'fixture' }),
      this.#fact('AnswerObserved', { raw: true, sessionId: 'a', answerId: `answer-${index}`, entryId: `answer-${index}`, excerpt: `answer ${index}`, interim: false, withheld: false }),
    ];
  }

  mutations(): Record<string, NewEvent> {
    return {
      'answer swap-pop and append': this.#fact('AnswerObserved', { requestId: 'first', answerId: 'stated-answer', interim: false, excerpt: 'done' }),
      'interruption swap-pop and append': this.#fact('RequestInterrupted', { requestId: 'first', sessionId: 'a', resetId: 'reset' }),
      'move drops a non-last contribution': this.#stated({ requestId: 'first', sessionId: 'b' }),
      'cross-owner move re-derives the previous session': this.#stated({ requestId: 'raw-0', sessionId: 'b' }),
    };
  }

  continuation(): NewEvent[] {
    return [...this.#rawPair(1000), this.#fact('SubagentStarted', { sessionId: 'a', parentSessionId: 'parent' })];
  }
}

interface Persistence { log: SqliteEventLog; path: string }

function requestIds(state: DerivationState) {
  return Object.fromEntries(Object.entries(state.sessions).map(([id, record]) => [id, record.requestIds]));
}

async function assertFullReplay(projector: Projector, log: SqliteEventLog): Promise<void> {
  const replay = new Projector(log, [requestDerivation]);
  await replay.catchUp();
  const actual = projector.state('requests') as DerivationState;
  const expected = replay.state('requests') as DerivationState;
  assert.deepEqual(requestIds(actual), requestIds(expected), 'persisted contribution arrays must match full replay');
  assert.equal(canonicalJson(actual), canonicalJson(expected), 'requests, facts and every session array must match full replay');
  assert.ok(Object.values(projector.skipped.counts).every(count => count === 0));
}

async function persistMutation(persistence: Persistence, initial: NewEvent[], mutation: NewEvent): Promise<void> {
  const store = new SqliteProjectionStore(persistence.path);
  try {
    await persistence.log.append(initial);
    const projector = new Projector(persistence.log, [requestDerivation], store);
    await projector.catchUp(); // Flush, but retain the cached renderers for the next event.
    await persistence.log.append([mutation]);
    await projector.catchUp();
    await assertFullReplay(projector, persistence.log);
  } finally { store.close(); }
}

async function restart(persistence: Persistence, continuation: NewEvent[] = []): Promise<void> {
  const store = new SqliteProjectionStore(persistence.path);
  try {
    const projector = new Projector(persistence.log, [requestDerivation], store);
    assert.equal(await projector.catchUp(), 0, 'the restart must load the committed checkpoint, not repair it by replay');
    await assertFullReplay(projector, persistence.log);
    if (continuation.length > 0) {
      await persistence.log.append(continuation);
      await projector.catchUp();
      await assertFullReplay(projector, persistence.log);
    }
  } finally { store.close(); }
}

for (const extraRequests of [0, 35]) {
  const fixture = new RestartFixture(extraRequests);
  for (const [name, mutation] of Object.entries(fixture.mutations())) {
    test(`${name} survives a fresh SQLite store (${extraRequests === 0 ? 'inline' : 'normalized'} session)`, async context => {
      const directory = mkdtempSync(join(tmpdir(), 'pi-console-request-restart-'));
      const log = new SqliteEventLog(join(directory, 'events.db'));
      context.after(() => { log.close(); rmSync(directory, { recursive: true, force: true }); });
      const persistence = { log, path: join(directory, 'projection.db') };
      await persistMutation(persistence, fixture.initial, mutation);
      await restart(persistence, fixture.continuation());
      await restart(persistence);
    });
  }
}

test('normalized request storage has a distinct version and rebuilds across upgrade and downgrade', async context => {
  assert.ok(requestDerivation.version > 4, 'normalized session rows must not be accepted as version 4 by older binaries');
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-request-version-'));
  const log = new SqliteEventLog(join(directory, 'events.db'));
  context.after(() => { log.close(); rmSync(directory, { recursive: true, force: true }); });
  await log.append(new RestartFixture(35).initial);
  const path = join(directory, 'projection.db');
  const version4 = { ...requestDerivation, version: 4 };
  const previous = new SqliteProjectionStore(path);
  try { await new Projector(log, [version4], previous).catchUp(); }
  finally { previous.close(); }
  const upgradedStore = new SqliteProjectionStore(path);
  try {
    const upgraded = new Projector(log, [requestDerivation], upgradedStore);
    assert.equal(upgraded.position, 0, 'an upgrade must discard the previous checkpoint');
    await upgraded.catchUp();
    await assertFullReplay(upgraded, log);
  } finally { upgradedStore.close(); }
  const downgradedStore = new SqliteProjectionStore(path);
  try {
    const downgraded = new Projector(log, [version4], downgradedStore);
    assert.equal(downgraded.position, 0, 'a downgrade must discard normalized rows before using session arrays');
    assert.equal(canonicalJson(downgraded.state('requests')), canonicalJson(version4.initial()));
  } finally { downgradedStore.close(); }
});
