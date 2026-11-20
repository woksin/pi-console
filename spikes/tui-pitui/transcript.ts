import { Model, origin, type Entry } from './model.ts';
import { Paint, clean, fit, spark } from './paint.ts';

type Line = { text: string; entry: Entry };

function entryLines(model: Model, p: Paint, entry: Entry, width: number): string[] {
  const time = p.text(entry.at.slice(11, 19) + ' ', 'dim');
  const text = clean(entry.text);
  switch (entry.kind) {
    case 'user': return [time + p.text('▸ REQUEST / origin not verified', 'amber', true), ...p.wrap(text, width - 2, 'text').map(line => '  ' + line), ''];
    case 'assistant': return [time + p.text('◂ assistant', 'cyan', true), ...p.wrap(text, width - 2).map(line => '  ' + line), ''];
    case 'assistant.delta': return [p.text('  ▍ ', 'cyan') + p.text(text, 'text')];
    case 'thinking':
      return [time + p.text(`${model.expanded.has(entry.id) ? '▾' : '▸'} thinking`, 'violet') + p.text('  ⏎ expand', 'dim'),
        ...(model.expanded.has(entry.id) ? p.wrap(text, width - 2, 'muted').map(line => '  ' + line) : [])];
    case 'tool.call':
      return [time + p.text(`${model.expanded.has(entry.id) ? '▾' : '▸'} ${fit(text, width - 35)}`, 'blue') + p.text('  call / result ↓', 'dim'),
        ...(model.expanded.has(entry.id) ? p.wrap(`args: ${text} · ${entry.toolCallId}`, width - 2, 'muted') : [])];
    case 'tool.result':
      return [time + p.text(`↳ ${entry.toolCallId} · returned`, 'green') + p.text('  exit status not supplied', 'dim'),
        ...(model.expanded.has(entry.id) ? p.wrap(text, width - 2, 'muted') : [])];
    case 'diff': return ['', p.text('  DIFF / src/queue.ts', 'blue', true), ...text.split('\n').map(line => p.text('  ' + fit(line, width - 2), diffColor(line))), ''];
    case 'reset': {
      const reset = model.data.resets.find(item => item.id === entry.resetId);
      return ['', p.rule(`RESET / ${reset?.kind ?? 'compaction'} / ${entry.resetId}`, width, 'magenta'),
        p.text(`  carried: ${reset?.carriedRequestIds.join(', ') ?? 'see boundary text'}`, 'magenta'),
        ...p.wrap(text, width - 2, 'muted').map(line => '  ' + line), ''];
    }
    default: return p.wrap(text, width);
  }
}

function diffColor(line: string) {
  if (line.startsWith('+')) return 'green' as const;
  if (line.startsWith('-')) return 'red' as const;
  if (line.startsWith('@@')) return 'blue' as const;
  return 'muted' as const;
}

export class Transcript {
  hits: { y: number; entry: Entry }[] = [];
  current: Entry | undefined;
  seek: number | undefined;
  private cache = new Map<string, Line[]>();
  private cacheKey = '';
  private anchor: { id: string; line: number } | undefined;
  private lastOffset = 0;

  render(model: Model, p: Paint, width: number, height: number) {
    const key = `${model.selected}:${width}:${p.contrast}:${[...model.expanded].join(',')}`;
    if (key !== this.cacheKey) { this.cache.clear(); this.cacheKey = key; this.anchor = undefined; }
    const retained = model.transcript;
    const lines: Line[] = [];
    // Tail work is bounded independently of incoming event rate.
    const entries = model.follow ? retained.slice(-140) : retained;
    const query = model.search.toLowerCase();
    for (const entry of entries) {
      if (query && !clean(entry.text).toLowerCase().includes(query)) continue;
      let formatted = this.cache.get(entry.id);
      if (!formatted) {
        formatted = entryLines(model, p, entry, width - 4).map(text => ({ text, entry }));
        this.cache.set(entry.id, formatted);
      }
      lines.push(...formatted);
    }
    if (this.cache.size > 6000) this.cache.clear();
    const capacity = height - 3;
    if (this.seek !== undefined) {
      const index = lines.findIndex(line => line.entry.cursor === this.seek);
      if (index >= 0) model.offset = Math.max(0, lines.length - capacity - index + 8);
      this.seek = undefined;
      this.anchor = undefined;
    }
    if (!model.follow && this.anchor && model.offset === this.lastOffset) {
      const index = lines.findIndex(line => line.entry.id === this.anchor!.id);
      if (index >= 0) model.offset = Math.max(0, lines.length - capacity - index - this.anchor.line);
    }
    model.offset = Math.min(model.offset, Math.max(0, lines.length - capacity));
    const top = model.follow ? Math.max(0, lines.length - capacity) : Math.max(0, lines.length - capacity - model.offset);
    const visible = lines.slice(top, top + capacity);
    this.lastOffset = model.offset;
    this.anchor = visible[0] ? { id: visible[0].entry.id, line: top - lines.findIndex(line => line.entry.id === visible[0].entry.id) } : undefined;
    this.hits = visible.map((line, index) => ({ y: index + 1, entry: line.entry }));
    this.current = visible.findLast(line => ['thinking', 'tool.call', 'tool.result'].includes(line.entry.kind))?.entry;
    const body = visible.map(line => line.text);
    if (!body.length) body.push(p.text(query ? 'No transcript matches. Esc clears search.' : 'No transcript recorded for this session.', 'muted'));
    while (body.length < capacity) body.push('');
    body.push(p.text(model.follow ? '● LIVE / following tail' : `↓ ${model.unseen} new / follow paused · f to resume`, model.follow ? 'green' : 'amber') + p.text(query ? `  /${clean(query)}` : `  ${retained.length} retained entries`, 'dim'));
    return p.box('01  TRANSCRIPT / timeline', body, width, height, model.focus === 0);
  }
}

export function rail(model: Model, p: Paint, width: number, height: number) {
  const session = model.session;
  const body: string[] = [];
  body.push(p.text('REQUESTS & ANSWERS', 'amber', true), p.text('Origins are evidence, not assumptions.', 'dim'), '');
  for (const request of model.data.requests.filter(item => item.sessionId === model.selected)) {
    const color = request.status === 'answered' ? 'green' : request.status === 'interrupted' ? 'magenta' : 'amber';
    body.push(p.text(`${request.status === 'answered' ? '✓' : request.status === 'interrupted' ? '/' : '!'} ${request.id}  ${request.status.toUpperCase()}`, color, true));
    body.push(p.text(origin(request), 'muted'), ...p.wrap(request.text, width - 4).slice(0, 3));
    if (request.answer) body.push(...p.wrap('↳ ' + request.answer.text, width - 4, 'green').slice(0, 2));
    else body.push(p.text('↳ no final answer', 'dim'));
    if (request.interimAnswers.length) body.push(...p.wrap('partial: ' + request.interimAnswers.at(-1)!.text, width - 4, 'muted').slice(0, 2));
    body.push('');
  }
  body.push(p.rule('SUBAGENTS', width - 4));
  const children = model.data.sessions.filter(item => item.parentSessionId === model.selected);
  for (const child of children) body.push(p.badge(child.status) + p.text(`  ${child.id} ${child.name}`, 'muted'));
  if (!children.length) body.push(p.text('No subagents', 'dim'));
  body.push('', p.rule('JOBS / PHASES', width - 4));
  for (const job of model.data.jobs.filter(item => item.sessionId === model.selected)) body.push(p.text(`${job.status === 'failed' ? '×' : '·'} ${job.name} / ${job.status}`, job.status === 'failed' ? 'red' : 'blue'));
  if (session) body.push('', p.rule(`CONTEXT / ${session.contextPercent}%`, width - 4), p.text(spark(session.samples.map(point => point.contextPercent), Math.min(width - 4, 30)), 'cyan'));
  return p.box('02  SESSION INTELLIGENCE', body.slice(model.railOffset), width, height, model.focus === 1);
}
