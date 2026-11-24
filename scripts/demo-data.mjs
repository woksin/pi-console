// Synthetic facts only. Use the gallery's explicit identities; cwd remains the shared repository workspace.
import { generate } from '../packages/testkit/src/fixture/generate.ts';
import { memoryItems } from '../packages/testkit/src/mock-daemon/memory.ts';
import { deriveRequests } from '../packages/testkit/src/mock-daemon/requests-derived.ts';
import { prepareShowcase, rebase } from './media/fixture.mjs';
import { finishedSession, liveQuestion, quietSession } from './media/showcase.ts';

export const demoTickMs = 7500;
export const demoTickLimit = 120;

/** The gallery publishes these same entity upserts; the mock derives attention changes and sequences its SSE stream. */
function liveEvents(fixture) {
  const active = quietSession(fixture, 'working');
  const finishing = quietSession({ ...fixture, sessions: fixture.sessions.filter(session => session.id !== active.id) }, 'working');
  let ticks = 0;
  return (now = new Date()) => {
    if (ticks >= demoTickLimit) return [];
    ticks++;
    const at = now.toISOString();
    const current = fixture.sessions.find(session => session.id === active.id);
    const events = [{ type: 'session.updated', payload: { ...current, updatedAt: at } }];
    if (ticks === 2) events.push({ type: 'session.updated', payload: { ...finishedSession(finishing), updatedAt: at } });
    if (ticks % 20 === 3) events.push({ type: 'question.asked', payload: {
      ...liveQuestion(active.id), id: `demo-live-${ticks}`, createdAt: at,
    } });
    return events;
  };
}

export function demoData(now = new Date()) {
  const { fixture } = generate(192);
  fixture.requests = deriveRequests(fixture);
  const memory = memoryItems().map(item => ({ ...item }));
  prepareShowcase(fixture, memory);
  // Memory's sample recording predates the fleet recording. Align it before shifting the whole showcase clock.
  const memoryHandoffAt = '2026-07-01T10:30:00.000Z';
  const alignedMemory = rebase(memory, Date.parse(fixture.generatedAt) - Date.parse(memoryHandoffAt));
  const seed = rebase({ fixture, memory: alignedMemory, memoryHandoffAt: fixture.generatedAt }, now.getTime() - Date.parse(fixture.generatedAt));
  return { ...seed, tick: liveEvents(seed.fixture) };
}
