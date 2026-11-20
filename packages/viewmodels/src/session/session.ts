import type { Job, Question, Request, Reset, Session, SessionDetail, TranscriptEntry } from '@pi-console/contract';
import type { ThemeToken } from '@pi-console/contract';
import { age, clock, money, pressure, sanitize, sparkline, type Pressure } from '../format/format.ts';
import { statusCell, type StatusCell } from '../format/status-cell.ts';
import { requestListViewModel, type RequestRow } from '../request-list/request-list.ts';

export type LineKind = 'user' | 'thinking' | 'assistant' | 'tool' | 'result' | 'diff' | 'reset';
export interface TranscriptLine {
  id: string; cursor: number;
  /** Stable identity of the logical line: the first delta's cursor for a streaming run, inherited by the final `assistant` entry that replaces it; the own cursor otherwise. Never changes as the line streams or finalises; ascending with transcript order. */
  key: number; time: string; kind: LineKind; glyph: string; label: string; color: ThemeToken; text: string;
  streaming: boolean; requestId: string | null; resetId: string | null;
  tool: { name: string; args: string; resultKind: string; withheld: boolean; truncated: boolean } | null;
}
export interface SessionViewModel {
  id: string; title: string; status: StatusCell; branch: string; cwd: string; model: string; role: Session['role']; age: string; cost: string;
  context: { percent: number; pressure: Pressure; spark: string };
  requests: RequestRow[]; questions: { id: string; text: string; blocking: boolean; status: string }[];
  jobs: { id: string; name: string; kind: string; status: StatusCell; exit: string }[];
  resets: { id: string; kind: Reset['kind']; time: string; carried: number; interrupted: number }[];
  subagents: { id: string; name: string; status: StatusCell }[];
  transcript: TranscriptLine[];
}

const style: Record<TranscriptEntry['kind'], { kind: LineKind; glyph: string; label: string; color: ThemeToken }> = {
  user: { kind: 'user', glyph: '▍', label: 'you', color: 'blue' },
  thinking: { kind: 'thinking', glyph: '◌', label: 'thinking', color: 'faint' },
  'assistant.delta': { kind: 'assistant', glyph: '●', label: 'assistant', color: 'text' },
  assistant: { kind: 'assistant', glyph: '●', label: 'assistant', color: 'text' },
  'tool.call': { kind: 'tool', glyph: '⚙', label: 'tool', color: 'cyan' },
  'tool.result': { kind: 'result', glyph: '↳', label: 'result', color: 'muted' },
  diff: { kind: 'diff', glyph: '±', label: 'diff', color: 'green' },
  reset: { kind: 'reset', glyph: '┃', label: 'reset', color: 'pink' },
};

function line(entry: TranscriptEntry, streaming = false): TranscriptLine {
  const { kind, glyph, label, color } = style[entry.kind];
  const result = entry.toolResult;
  return {
    id: entry.id, cursor: entry.cursor, key: entry.cursor, time: clock(entry.at), kind, glyph, label, color, streaming,
    text: sanitize(result?.withheld ? '[withheld by the daemon: secret-shaped content]' : entry.text), requestId: entry.requestId ?? null, resetId: entry.resetId ?? null,
    tool: result ? { name: result.toolName, args: sanitize(result.argsExcerpt), resultKind: result.resultKind, withheld: result.withheld, truncated: result.truncated } : null,
  };
}

/** Collapses a run of streaming deltas into one line. A run is consecutive deltas of the same request (`requestId`, null counting as its own request); any other entry, a different request, a reset or an abort ends it, and an ended run stays its own line keyed by its first delta. A final `assistant` entry replaces only a directly preceding run of the same request. */
export function transcriptLines(entries: readonly TranscriptEntry[]): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  let run: TranscriptEntry[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const last = run[run.length - 1];
    lines.push({ ...line({ ...last, text: run.map(entry => entry.text).join('') }, true), id: run[0].id, cursor: last.cursor, key: run[0].cursor });
    run = [];
  };
  const sameRequest = (entry: TranscriptEntry) => (run[0].requestId ?? null) === (entry.requestId ?? null);
  for (const entry of entries) {
    if (entry.kind === 'assistant.delta') {
      if (run.length > 0 && !sameRequest(entry)) flush();
      run.push(entry);
      continue;
    }
    const replaced = entry.kind === 'assistant' && run.length > 0 && sameRequest(entry) ? run[0].cursor : undefined;
    if (replaced !== undefined) run = [];
    flush();
    lines.push(replaced === undefined ? line(entry) : { ...line(entry), key: replaced });
  }
  flush();
  return lines;
}

const questionRows = (questions: readonly Question[]) => questions.map(question => ({ id: question.id, text: sanitize(question.text), blocking: question.blocking, status: question.status }));
const jobRows = (jobs: readonly Job[]) => jobs.map(job => ({ id: job.id, name: job.name, kind: job.kind, status: statusCell(job.status), exit: job.exitCode === null ? '' : `exit ${String(job.exitCode)}` }));

export function sessionViewModel(input: { detail: SessionDetail; transcript: readonly TranscriptEntry[]; now: number; search?: string }): SessionViewModel {
  const { session } = input.detail;
  const needle = input.search?.toLowerCase() ?? '';
  const all = transcriptLines(input.transcript);
  const requests: readonly Request[] = input.detail.requests;
  return {
    id: session.id, title: `${session.repositoryId} / ${session.laneId} / ${session.name}`, status: statusCell(session.status), branch: session.branch, cwd: session.cwd,
    model: session.model, role: session.role, age: age(session.updatedAt, input.now), cost: money(session.samples.reduce((sum, sample) => sum + sample.costUsd, 0)),
    context: { percent: session.contextPercent, pressure: pressure(session.contextPercent), spark: sparkline(session.samples.map(sample => sample.contextPercent), 100) },
    requests: requestListViewModel({ requests, sessions: [session], now: input.now }).rows, questions: questionRows(input.detail.questions), jobs: jobRows(input.detail.jobs),
    resets: input.detail.resets.map(reset => ({ id: reset.id, kind: reset.kind, time: clock(reset.at), carried: reset.carriedRequestIds.length, interrupted: reset.interruptedRequestIds.length })),
    subagents: input.detail.subagents.map(sub => ({ id: sub.id, name: sub.name, status: statusCell(sub.status) })),
    transcript: needle ? all.filter(item => item.text.toLowerCase().includes(needle) || item.kind === 'reset') : all,
  };
}
