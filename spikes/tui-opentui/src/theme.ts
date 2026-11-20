export type Colors = '16' | '256' | 'truecolor';
const ansi = ['#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0', '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'];
function rgb(hex: string) { return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)); }
export function quantize(hex: string, mode: Colors) {
  if (mode === 'truecolor') return hex;
  const source = rgb(hex);
  const palette = mode === '16' ? ansi : [
    ...ansi,
    ...Array.from({ length: 216 }, (_, i) => '#' + [Math.floor(i / 36), Math.floor(i / 6) % 6, i % 6].map(n => [0, 95, 135, 175, 215, 255][n].toString(16).padStart(2, '0')).join('')),
    ...Array.from({ length: 24 }, (_, i) => '#' + (8 + i * 10).toString(16).padStart(2, '0').repeat(3)),
  ];
  const distance = (color: string) => rgb(color).reduce((sum, channel, i) => sum + (channel - source[i]) ** 2, 0);
  return palette.reduce((best, color) => distance(color) < distance(best) ? color : best);
}
export function theme(mode: Colors, contrast = false) {
  const raw = {
    bg: '#0b1019', panel: '#101925', raised: '#172434', border: '#2b3b50',
    text: '#d8e2ef', muted: '#8b9eb5', faint: '#627992', cyan: '#66d9ef',
    blue: '#819cff', amber: '#f5bf65', green: '#85d9a0', red: '#fa7989',
    orange: '#f49b6c', violet: '#b49afa', pink: '#e996d0', select: '#203c50', flash: '#32413b',
  };
  if (contrast) Object.assign(raw, { bg: '#000000', panel: '#000000', text: '#ffffff', muted: '#c0c0c0', border: '#819cff' });
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, quantize(value, mode)])) as typeof raw;
}
export type Theme = ReturnType<typeof theme>;
export function status(t: Theme, value: string): [string, string] {
  const values: Record<string, [string, string]> = {
    'needs-you': ['!', t.amber], working: ['*', t.cyan], running: ['*', t.cyan],
    blocked: ['×', t.orange], failed: ['×', t.red], waiting: ['~', t.violet],
    interrupted: ['/', t.pink], done: ['✓', t.green], answered: ['✓', t.green],
    unanswered: ['!', t.amber], open: ['!', t.amber], idle: ['–', t.faint],
  };
  return values[value] ?? ['·', t.muted];
}
export function spark(values: number[], max = 100) {
  return values.map(value => '▁▂▃▄▅▆▇█'[Math.min(7, Math.max(0, Math.floor(value / max * 7)))]).join('');
}
