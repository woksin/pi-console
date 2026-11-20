import { stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';

export type Depth = '16' | '256' | 'truecolor';
export const colors = {
  bg: '#0b1019', panel: '#101925', raised: '#172436', selected: '#21384b',
  text: '#d9e3ee', muted: '#8193a9', dim: '#52677e', line: '#2b4057',
  cyan: '#6cdef1', blue: '#8aa5ff', amber: '#f4c16e', green: '#8dd5ad',
  red: '#f48291', orange: '#e9a074', violet: '#b7a0ed', magenta: '#e79fd1',
};
export type Color = keyof typeof colors;
const ansi16: Record<Color, number> = {
  bg: 0, panel: 0, raised: 0, selected: 4, text: 15, muted: 7, dim: 8, line: 8,
  cyan: 14, blue: 12, amber: 11, green: 10, red: 9, orange: 3, violet: 13, magenta: 13,
};
export const statuses: Record<string, [string, Color]> = {
  working: ['*', 'cyan'], 'needs-you': ['!', 'amber'], blocked: ['×', 'orange'],
  failed: ['×', 'red'], waiting: ['~', 'violet'], idle: ['·', 'muted'],
  done: ['✓', 'green'], interrupted: ['/', 'magenta'], stale: ['?', 'dim'],
};

export function clean(value: string) {
  return stripTerminalSequences(String(value)).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').replace(/\t/g, '  ');
}

export function fit(value: string, width: number) {
  const text = truncateToWidth(value, Math.max(0, width), '…');
  return text + ' '.repeat(Math.max(0, width - visibleWidth(text)));
}

export class Paint {
  contrast = false;
  depth: Depth;
  constructor(depth: Depth) { this.depth = depth; }

  escape(color: Color, background = false) {
    if (this.depth === '16') {
      const index = ansi16[color];
      return `\x1b[${(background ? 40 : 30) + index % 8 + (index > 7 ? 60 : 0)}m`;
    }
    const hex = this.contrast && color === 'bg' ? '#000000' : colors[color];
    const rgb = hex.slice(1).match(/../g)!.map(part => parseInt(part, 16));
    if (this.depth === 'truecolor') return `\x1b[${background ? 48 : 38};2;${rgb.join(';')}m`;
    const index = 16 + 36 * Math.round(rgb[0] / 51) + 6 * Math.round(rgb[1] / 51) + Math.round(rgb[2] / 51);
    return `\x1b[${background ? 48 : 38};5;${index}m`;
  }

  text(value: string, color: Color = 'text', bold = false) {
    return this.escape(color) + (bold ? '\x1b[1m' : '') + value + '\x1b[22m' + this.escape('text');
  }

  surface(value: string, width: number, background: Color = 'bg') {
    return this.escape(background, true) + this.escape('text') + fit(value, width) + '\x1b[0m';
  }

  badge(status: string) {
    const [glyph, color] = statuses[status] ?? ['?', 'muted'];
    return this.text(`${glyph} ${status}`, color);
  }

  gradient(value: string) {
    const ramp: Color[] = ['cyan', 'blue', 'violet', 'magenta'];
    return [...value].map((char, i) => {
      const ratio = i / Math.max(1, value.length - 1);
      if (this.depth !== 'truecolor') return this.text(char, ramp[Math.min(3, Math.floor(ratio * 4))], true);
      const start = [108, 222, 241];
      const end = [231, 159, 209];
      const rgb = start.map((channel, axis) => Math.round(channel + (end[axis] - channel) * ratio));
      return `\x1b[38;2;${rgb.join(';')}m\x1b[1m${char}\x1b[22m`;
    }).join('') + this.escape('text');
  }

  rule(label: string, width: number, color: Color = 'dim') {
    const title = ` ${label} `;
    return this.text('─' + fit(title, Math.min(title.length, width - 1)) + '─'.repeat(Math.max(0, width - title.length - 1)), color);
  }

  box(title: string, body: string[], width: number, height: number, focused = false, accent: Color = 'cyan') {
    const edge: Color = focused ? accent : 'line';
    const label = ` ${title} `;
    const top = this.text('╭─', edge) + this.text(fit(label, Math.min(width - 4, visibleWidth(label))), focused ? accent : 'muted', true)
      + this.text('─'.repeat(Math.max(0, width - 3 - visibleWidth(fit(label, Math.min(width - 4, visibleWidth(label)))))) + '╮', edge);
    const lines = [this.surface(top, width)];
    for (let i = 0; i < height - 2; i++) {
      lines.push(this.surface(this.text('│', edge) + ' ' + fit(body[i] ?? '', width - 4) + ' ' + this.text('│', edge), width, 'panel'));
    }
    lines.push(this.surface(this.text('╰' + '─'.repeat(Math.max(0, width - 2)) + '╯', edge), width));
    return lines;
  }

  wrap(text: string, width: number, color: Color = 'text') {
    return wrapTextWithAnsi(clean(text), Math.max(1, width)).map(line => this.text(line, color));
  }
}

export function spark(values: number[], width = 10, max = 100) {
  const blocks = '▁▂▃▄▅▆▇█';
  return Array.from({ length: width }, (_, i) => {
    const value = values[Math.min(values.length - 1, Math.floor(i / width * values.length))] ?? 0;
    return blocks[Math.max(0, Math.min(7, Math.floor(value / max * 7)))];
  }).join('');
}

export function compact(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}
