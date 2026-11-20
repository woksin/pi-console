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

function parseBlock(block: string): SseFrame | null {
  let id: string | null = null;
  let event = 'message';
  const data: string[] = [];
  let comment = false;
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) { comment = true; continue; }
    const split = line.indexOf(':');
    const field = split < 0 ? line : line.slice(0, split);
    const value = split < 0 ? '' : line.slice(split + 1).replace(/^ /, '');
    if (field === 'id') id = value;
    else if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return comment ? { comment: true } : null;
  return { comment: false, id, event, data: data.join('\n') };
}
