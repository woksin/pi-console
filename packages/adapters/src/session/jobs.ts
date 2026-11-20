import type { Fact } from '../tailing/events.ts';
import { fact, integer, list, object, text } from '../values.ts';

const terminal = new Map<unknown, string>([['succeeded', 'done'], ['matched', 'done'], ['failed', 'failed'], ['timed_out', 'failed'], ['killed', 'failed']]);

function finished(job: Record<string, unknown>, at: unknown, entryId: string): Fact[] {
  if (job.status === 'running') return [];
  const status = terminal.get(job.status);
  if (!status) throw new Error('Unknown job status');
  const jobId = text(job.id);
  return [fact('JobFinished', `job:${jobId}`, {
    jobId, status, exitCode: job.exitCode == null ? null : integer(job.exitCode),
  }, at, entryId)];
}

/** Only pi-jobs' structured delivery details; never interpret notification prose. */
export function jobMessageFacts(record: Record<string, unknown>): Fact[] {
  if (record.customType !== 'pi-jobs') return [];
  const details = object(record.details);
  return list(details.completions).flatMap(completion => {
    return finished(object(completion.job), record.timestamp, text(record.id))
      .map(result => ({ ...result, observationId: text(completion.completionId) }));
  });
}

export function jobToolFacts(record: Record<string, unknown>, message: Record<string, unknown>): Fact[] {
  if (!['job_start', 'job_watch', 'job_subscribe'].includes(text(message.toolName))) return [];
  if (message.isError === true) return [];
  const job = object(message.details);
  const jobId = text(job.id);
  const entryId = text(record.id);
  const started = fact('JobStarted', `job:${jobId}`, {
    jobId, name: text(job.label ?? job.command), kind: 'job',
  }, job.startedAt, entryId);
  return [started, ...finished(job, job.finishedAt, entryId)];
}
