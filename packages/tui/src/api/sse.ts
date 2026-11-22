/** Incremental Server-Sent Events parser: feed chunks, receive complete frames. Comments notify the optional heartbeat listener. */
export interface Frame { id?: string; event?: string; data: string }

export class FrameParser {
  private buffer = '';

  private readonly heartbeat: () => void;

  constructor(heartbeat: () => void = () => undefined) { this.heartbeat = heartbeat; }

  push(chunk: string): Frame[] {
    this.buffer += chunk.replace(/\r\n?/g, '\n');
    const frames: Frame[] = [];
    for (let end = this.buffer.indexOf('\n\n'); end >= 0; end = this.buffer.indexOf('\n\n')) {
      const block = this.buffer.slice(0, end);
      if (block.split('\n').some(line => line.startsWith(':'))) this.heartbeat();
      const frame = parse(block);
      this.buffer = this.buffer.slice(end + 2);
      if (frame) frames.push(frame);
    }
    return frames;
  }
}

function parse(block: string): Frame | undefined {
  const data: string[] = [];
  const frame: Frame = { data: '' };
  for (const line of block.split('\n')) {
    if (line.startsWith(':') || line === '') continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'data') data.push(value);
    else if (field === 'id') frame.id = value;
    else if (field === 'event') frame.event = value;
  }
  if (data.length === 0) return undefined;
  frame.data = data.join('\n');
  return frame;
}
