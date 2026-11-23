// Gallery-only synthetic question history and one idle open question, so Questions shows History, "Last activity" and a Stale chip.
// Both clients use the shared capture time, including the web's snapshot clock.
import type { Rig } from '../../packages/web/e2e/harness.ts';

interface GalleryQuestion { id: string; createdAt: string; updatedAt?: string; history?: unknown[] }
const entry = (sequence: number, operation: string, at: string, actor: string, excerpt?: string) => ({ sequence, operation, at, actor, ...(excerpt ? { excerpt } : {}) });

/** The idle question's state: recent by default, so the Timeline axis stays at the fixture day; old only for the shots that show Stale. */
function setIdleQuestion(questions: GalleryQuestion[], idle: boolean): void {
  const question = questions.find(candidate => candidate.id === 'q3');
  if (!question) return;
  const [created, deferred] = idle ? ['2026-11-02T09:00:00Z', '2026-11-08T14:00:00Z'] : ['2026-11-20T09:02:00Z', '2026-11-20T09:10:00Z'];
  question.createdAt = created;
  question.updatedAt = deferred;
  question.history = [entry(2, 'deferred', deferred, 'L0', 'Parked until the migration window opens.'), entry(1, 'created', created, 'L3')];
}

export function recordQuestionHistory(questions: GalleryQuestion[]): void {
  const byId = new Map(questions.map(question => [question.id, question]));
  const q1 = byId.get('q1');
  if (q1) {
    q1.updatedAt = '2026-11-20T09:15:00Z';
    q1.history = [
      entry(3, 'comment', '2026-11-20T09:15:00Z', 'L0', 'Leaning towards 14 days; the queue budget is the constraint.'),
      entry(2, 'edited', '2026-11-20T09:08:00Z', 'L1', 'Added the retry budget to the question.'),
      entry(1, 'created', '2026-11-20T09:00:00Z', 'L1'),
    ];
  }
  const q2 = byId.get('q2');
  if (q2) {
    q2.updatedAt = '2026-11-20T09:12:00Z';
    q2.history = [entry(2, 'comment', '2026-11-20T09:12:00Z', 'L2', 'Waiting for the checkpoint contract to be verified.'), entry(1, 'created', q2.createdAt, 'L2')];
  }
  setIdleQuestion(questions, false);
}

/** Runs `capture` with the idle question idle for eleven days, then puts it back. */
export async function withStaleQuestion<T>(rig: Rig, capture: () => Promise<T>): Promise<T> {
  setIdleQuestion(rig.daemon.store.fixture.questions, true);
  try { return await capture(); } finally { setIdleQuestion(rig.daemon.store.fixture.questions, false); }
}
