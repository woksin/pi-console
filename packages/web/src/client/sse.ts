/** One parsed Server-Sent Event frame. Comment lines (heartbeats) yield `{ comment: true }` so liveness can be tracked. */
export type SseFrame = { comment: true } | { comment: false; id: string | null; event: string; data: string };

/** Incremental SSE parser: feed text chunks in any split, collect complete frames. */
export class SseParser {
  #buffer = '';

  push(chunk: string): SseFrame[] {
    this.#buffer += chunk.replace(/\r\n?/g, '\n');
    const frames: SseFrame[] = [];
    let end = this.#buffer.indexOf('\n\n');
    while (end >= 0) {
      const frame = parseBlock(this.#buffer.slice(0, end));
      if (frame) frames.push(frame);
      this.#buffer = this.#buffer.slice(end + 2);
      end = this.#buffer.indexOf('\n\n');
    }
    return frames;
  }
}

interface Fields { id: string | null; event: string; data: string[]; comment: boolean }

/** Splits `field: value` (one optional space after the colon is not part of the value). */
function splitField(line: string): [string, string] {
  const split = line.indexOf(':');
  return split < 0 ? [line, ''] : [line.slice(0, split), line.slice(split + 1).replace(/^ /, '')];
}

function readLine(fields: Fields, line: string): void {
  if (line.startsWith(':')) { fields.comment = true; return; }
  const [field, value] = splitField(line);
  if (field === 'id') fields.id = value;
  else if (field === 'event') fields.event = value;
  else if (field === 'data') fields.data.push(value);
}

function parseBlock(block: string): SseFrame | null {
  const fields: Fields = { id: null, event: 'message', data: [], comment: false };
  for (const line of block.split('\n')) readLine(fields, line);
  if (fields.data.length === 0) return fields.comment ? { comment: true } : null;
  return { comment: false, id: fields.id, event: fields.event, data: fields.data.join('\n') };
}
