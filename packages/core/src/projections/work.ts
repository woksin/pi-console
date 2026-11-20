import { entry, markDirty, projection } from '../projector/handlers.ts';

export interface JobModel {
  id: string;
  sessionId: string | null;
  kind: 'job' | 'phase' | 'ci';
  name: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  startedAt: string;
  exitCode: number | null;
}

export interface ReviewModel { id: string; headSha: string; verdict: string; at: string }

export interface WorkState { jobs: Record<string, JobModel>; reviews: Record<string, ReviewModel> }

const blank = (id: string, kind: JobModel['kind'], at: string) => (): JobModel => ({
  id, sessionId: null, kind, name: id, status: 'queued', startedAt: at, exitCode: null,
});

/** Finished is final: a late start or queue event never reopens a finished job. */
const finished = (job: JobModel) => job.status === 'done' || job.status === 'failed';
const phaseId = (id: string) => `phase:${id}`;

export const workProjection = projection<WorkState>('work', 2, () => ({ jobs: {}, reviews: {} }), {
  JobStarted(state, payload, event) {
    markDirty(state, 'jobs', payload.jobId);
    const job = entry(state.jobs, payload.jobId, blank(payload.jobId, payload.kind, event.occurredAt));
    Object.assign(job, { sessionId: payload.sessionId ?? null, kind: payload.kind, name: payload.name, startedAt: event.occurredAt });
    if (!finished(job)) job.status = 'running';
  },
  JobFinished(state, payload, event) {
    markDirty(state, 'jobs', payload.jobId);
    Object.assign(entry(state.jobs, payload.jobId, blank(payload.jobId, 'job', event.occurredAt)), { status: payload.status, exitCode: payload.exitCode ?? null });
  },
  PhaseQueued(state, payload, event) {
    markDirty(state, 'jobs', phaseId(payload.phaseId));
    entry(state.jobs, phaseId(payload.phaseId), blank(phaseId(payload.phaseId), 'phase', event.occurredAt)).name = payload.label;
  },
  PhaseStarted(state, payload, event) {
    markDirty(state, 'jobs', phaseId(payload.phaseId));
    const job = entry(state.jobs, phaseId(payload.phaseId), blank(phaseId(payload.phaseId), 'phase', event.occurredAt));
    Object.assign(job, { name: payload.label, startedAt: event.occurredAt });
    if (!finished(job)) job.status = 'running';
  },
  PhaseFinished(state, payload, event) {
    markDirty(state, 'jobs', phaseId(payload.phaseId));
    const exitCode = payload.exitCode ?? null;
    Object.assign(entry(state.jobs, phaseId(payload.phaseId), blank(phaseId(payload.phaseId), 'phase', event.occurredAt)), {
      name: payload.label, exitCode, status: exitCode === 0 ? 'done' : 'failed',
    });
  },
  ReviewRecorded(state, payload, event) {
    markDirty(state, 'reviews', payload.reviewId);
    state.reviews[payload.reviewId] = { id: payload.reviewId, headSha: payload.headSha, verdict: payload.verdict, at: event.occurredAt };
  },
}, ['jobs', 'reviews']);
