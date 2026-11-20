import type { Reset, TranscriptEntry } from '@pi-console/contract';
import { clean, clip, clockSeconds } from '../common/format.ts';

export type RowKind = 'user' | 'assistant' | 'thinking' | 'tool' | 'diff' | 'reset';

export interface ToolView { name: string; args: string; resultKind: string; result: string; truncated: boolean; withheld: boolean; finished: boolean }

export interface ResetMarker { id: string; kind: Reset['kind']; at: string; carried: string[]; interrupted: string[] }

export interface TranscriptRow {
  id: string;
  cursor: number;
  kind: RowKind;
  at: string;
  glyph: string;
  label: string;
  /** One-line summary shown when collapsed. */
  summary: string;
  /** Full sanitised text (rendered as text only, never as markup). */
  text: string;
  collapsed: boolean;
  expandable: boolean;
  requestId: string | null;
  tool: ToolView | null;
  reset: ResetMarker | null;
  streaming: boolean;
  match: boolean;
  target: boolean;
}

const labels: Record<RowKind, { glyph: string; label: string }> = {
  user: { glyph: '▸', label: 'you' }, assistant: { glyph: '◂', label: 'assistant' }, thinking: { glyph: '…', label: 'thinking' },
  tool: { glyph: '⚙', label: 'tool' }, diff: { glyph: '±', label: 'diff' }, reset: { glyph: '┃', label: 'reset' },
};

const collapsedByDefault = new Set<RowKind>(['thinking', 'tool', 'diff']);

type Draft = Omit<TranscriptRow, 'collapsed' | 'expandable' | 'match' | 'target' | 'summary'>;

function draftFor(entry: TranscriptEntry, kind: RowKind, text: string): Draft {
  return {
    id: entry.id, cursor: entry.cursor, kind, at: clockSeconds(entry.at), ...labels[kind], text, requestId: entry.requestId,
    tool: null, reset: null, streaming: false,
  };
}

function toolFor(entry: TranscriptEntry, call: boolean): ToolView {
  const result = entry.toolResult;
  return {
    name: result?.toolName ?? (call ? clip(entry.text, 40).split(' ')[0] : 'tool'), args: clean(result?.argsExcerpt ?? (call ? entry.text : '')),
    resultKind: result?.resultKind ?? 'none', result: clean(result?.resultExcerpt ?? (call ? '' : entry.text)),
    truncated: result?.truncated ?? false, withheld: result?.withheld ?? false, finished: !call,
  };
}

function resetFor(entry: TranscriptEntry, resets: readonly Reset[]): ResetMarker {
  const reset = resets.find(item => item.id === entry.resetId);
  return {
    id: entry.resetId ?? entry.id, kind: reset?.kind ?? 'handoff', at: clockSeconds(reset?.at ?? entry.at),
    carried: reset?.carriedRequestIds ?? [], interrupted: reset?.interruptedRequestIds ?? [],
  };
}

function mergeResult(rows: Draft[], entry: TranscriptEntry): boolean {
  const call = rows.findLast(row => row.kind === 'tool' && !row.tool?.finished && entry.toolCallId !== null);
  if (!call) return false;
  call.tool = { ...toolFor(entry, false), name: entry.toolResult?.toolName ?? call.tool?.name ?? 'tool', args: entry.toolResult?.argsExcerpt ? clean(entry.toolResult.argsExcerpt) : call.tool?.args ?? '' };
  return true;
}

/** Folds raw entries into display rows: deltas coalesce, a tool result joins its call, resets become markers. */
export function foldEntries(entries: readonly TranscriptEntry[], resets: readonly Reset[]): Draft[] {
  const rows: Draft[] = [];
  for (const entry of entries) {
    const last = rows.at(-1);
    if (entry.kind === 'assistant.delta') {
      if (last?.kind === 'assistant' && last.streaming) last.text += clean(entry.text);
      else rows.push({ ...draftFor(entry, 'assistant', clean(entry.text)), streaming: true });
    } else if (entry.kind === 'assistant') {
      if (last?.kind === 'assistant' && last.streaming) { last.text = clean(entry.text); last.streaming = false; }
      else rows.push(draftFor(entry, 'assistant', clean(entry.text)));
    } else if (entry.kind === 'tool.call') rows.push({ ...draftFor(entry, 'tool', clean(entry.text)), tool: toolFor(entry, true) });
    else if (entry.kind === 'tool.result') {
      if (!mergeResult(rows, entry)) rows.push({ ...draftFor(entry, 'tool', clean(entry.text)), tool: toolFor(entry, false) });
    } else if (entry.kind === 'reset') rows.push({ ...draftFor(entry, 'reset', clean(entry.text)), reset: resetFor(entry, resets) });
    else rows.push(draftFor(entry, entry.kind, clean(entry.text)));
  }
  return rows;
}

export function summaryOf(row: Draft): string {
  if (row.tool) return clip(`${row.tool.name} ${row.tool.args}`, 110);
  if (row.reset) return `${row.reset.kind} · ${String(row.reset.carried.length)} carried, ${String(row.reset.interrupted.length)} interrupted`;
  return clip(row.text, 140);
}

export function finishRows(rows: Draft[], expanded: ReadonlySet<string>, query: string, target: string | null): TranscriptRow[] {
  const needle = query.trim().toLowerCase();
  return rows.map(row => {
    const summary = summaryOf(row);
    const expandable = collapsedByDefault.has(row.kind) || row.text.length > 220;
    const isTarget = row.id === target;
    const defaultCollapsed = collapsedByDefault.has(row.kind);
    const open = expanded.has(row.id) || isTarget;
    return {
      ...row, summary, expandable, collapsed: expandable && (defaultCollapsed || row.text.length > 220) && !open,
      match: needle !== '' && `${row.text} ${row.tool?.args ?? ''} ${row.tool?.result ?? ''}`.toLowerCase().includes(needle), target: isTarget,
    };
  });
}
