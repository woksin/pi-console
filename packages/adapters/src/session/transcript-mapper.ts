import type { TranscriptEntry } from '@pi-console/contract';
import { object, text, timestamp } from '../values.ts';
import { redact } from '../tailing/redact.ts';

type Presentation = Pick<TranscriptEntry, 'kind' | 'text' | 'toolCallId' | 'resetId'>;
const summary = (value: string) => redact(value).text ?? '[withheld]';
const optionalId = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value : null;

function blocks(content: unknown): Record<string, unknown>[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) throw new Error('Unsupported transcript content');
  return content.map(object);
}

function blockText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Unsupported transcript text');
  return value;
}

function blockSummary(block: Record<string, unknown>, mixed: boolean): string {
  switch (block.type) {
    case 'text': return `${mixed ? 'Text: ' : ''}${blockText(block.text)}`;
    case 'thinking': return `${mixed ? 'Thinking: ' : ''}${blockText(block.thinking)}`;
    case 'toolCall': return `Tool call: ${text(block.name)}`;
    default: throw new Error('Unsupported transcript block');
  }
}

function assistant(content: unknown): Presentation {
  const parts = blocks(content);
  if (!parts.length) throw new Error('Empty transcript content');
  const types = new Set(parts.map(part => part.type));
  const calls = parts.filter(part => part.type === 'toolCall');
  const kind = types.has('text') ? 'assistant' : types.has('thinking') ? 'thinking' : 'tool.call';
  const body = parts.map(part => blockSummary(part, types.size > 1)).join('\n');
  return { kind, text: summary(body), toolCallId: calls.length === 1 ? optionalId(calls[0].id) : null, resetId: null };
}

function textContent(content: unknown): string {
  const parts = blocks(content);
  if (parts.some(part => part.type !== 'text')) throw new Error('Unsupported transcript content');
  return summary(parts.map(part => blockText(part.text)).join('\n'));
}

function message(record: Record<string, unknown>): Presentation {
  const value = object(record.message);
  switch (value.role) {
    case 'user': return { kind: 'user', text: textContent(value.content), toolCallId: null, resetId: null };
    case 'assistant': return assistant(value.content);
    // V3 results do not carry trustworthy argument excerpts or redaction/truncation flags. Do not invent
    // the required v1 ToolResult fields by guessing or pairing another record; the row itself remains useful.
    case 'toolResult': return { kind: 'tool.result', text: textContent(value.content), toolCallId: optionalId(value.toolCallId), resetId: null };
    default: throw new Error('Unsupported transcript role');
  }
}

/** Presentation only: one row per displayable source record, never derived request pairing or raw JSON fallback.
 * Input is already recursively redacted by the framed reader; combined summaries are scanned before truncation too.
 */
export function transcriptEntry(value: unknown, sessionId: string, start: number): TranscriptEntry | undefined {
  try {
    const record = object(value);
    const id = text(record.id);
    const at = new Date(timestamp(record.timestamp)).toISOString();
    let presentation: Presentation;
    if (record.type === 'message') presentation = message(record);
    else if (record.type === 'compaction') presentation = { kind: 'reset', text: typeof record.summary === 'string' ? summary(record.summary) : '', toolCallId: null, resetId: id };
    else return undefined;
    return { id, cursor: start + 1, sessionId, at, ...presentation };
  } catch { return undefined; }
}
