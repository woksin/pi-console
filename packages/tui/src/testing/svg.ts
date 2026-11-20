import type { Terminal } from '@xterm/headless';

const CELL_WIDTH = 8.4;
const CELL_HEIGHT = 18;
const escapeXml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const hex = (value: number) => `#${value.toString(16).padStart(6, '0')}`;

type Cell = ReturnType<NonNullable<ReturnType<Terminal['buffer']['active']['getLine']>>['getCell']>;

/** xterm palette: 16 ANSI, a 6x6x6 cube and 24 greys; only reached when a view is rendered below truecolor. */
function paletteColor(index: number): string {
  if (index < 16) return ['#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5', '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff'][index] ?? '#ffffff';
  if (index >= 232) return hex(((8 + (index - 232) * 10) * 0x10101));
  const n = index - 16;
  const level = (v: number) => (v === 0 ? 0 : 55 + v * 40);
  return hex((level(Math.floor(n / 36)) << 16) | (level(Math.floor(n / 6) % 6) << 8) | level(n % 6));
}

const colourOf = (cell: NonNullable<Cell>, foreground: boolean, fallback: string): string => {
  const isRgb = foreground ? cell.isFgRGB() : cell.isBgRGB();
  const isPalette = foreground ? cell.isFgPalette() : cell.isBgPalette();
  const value = foreground ? cell.getFgColor() : cell.getBgColor();
  return isRgb ? hex(value) : isPalette ? paletteColor(value) : fallback;
};

/** Renders the visible emulator screen as a self-contained SVG, with colours, bold and underline as drawn by the TUI. */
export function screenToSvg(terminal: Terminal, theme: { background: string; foreground: string }, title: string): string {
  const width = Math.ceil(terminal.cols * CELL_WIDTH) + 24;
  const height = terminal.rows * CELL_HEIGHT + 24;
  const rects: string[] = [];
  const texts: string[] = [];
  for (let row = 0; row < terminal.rows; row++) {
    const line = terminal.buffer.active.getLine(row);
    if (!line) continue;
    let fill = '';
    let fillStart = 0;
    let fillWidth = 0;
    const flushFill = () => {
      if (fill) rects.push(`<rect x="${(12 + fillStart * CELL_WIDTH).toFixed(1)}" y="${String(12 + row * CELL_HEIGHT)}" width="${(CELL_WIDTH * fillWidth).toFixed(1)}" height="${String(CELL_HEIGHT)}" fill="${fill}"/>`);
      fill = '';
    };
    let run = '';
    let runStart = 0;
    let runStyle = '';
    const flush = () => {
      if (run.trim() !== '') texts.push(`<text x="${(12 + runStart * CELL_WIDTH).toFixed(1)}" y="${String(12 + row * CELL_HEIGHT + 13)}" ${runStyle} xml:space="preserve">${escapeXml(run)}</text>`);
      run = '';
    };
    for (let column = 0; column < terminal.cols; column++) {
      const cell = line.getCell(column);
      if (!cell || cell.getWidth() === 0) continue;
      const inverse = cell.isInverse() !== 0;
      let foreground = colourOf(cell, true, theme.foreground);
      const background = colourOf(cell, false, theme.background);
      const [drawForeground, drawBackground] = inverse ? [background, foreground] : [foreground, background];
      foreground = drawForeground;
      const wanted = drawBackground === theme.background ? '' : drawBackground;
      if (wanted !== fill) { flushFill(); fill = wanted; fillStart = column; fillWidth = 0; }
      fillWidth += cell.getWidth();
      const style = `fill="${foreground}"${cell.isBold() ? ' font-weight="700"' : ''}${cell.isItalic() ? ' font-style="italic"' : ''}${cell.isUnderline() ? ' text-decoration="underline"' : ''}${cell.isDim() ? ' opacity="0.6"' : ''}`;
      const chars = cell.getChars() || ' ';
      if (style !== runStyle) { flush(); runStart = column; runStyle = style; }
      run += chars;
    }
    flush();
    flushFill();
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}" role="img" aria-label="${escapeXml(title)}">
<title>${escapeXml(title)}</title>
<rect width="100%" height="100%" rx="8" fill="${theme.background}"/>
${rects.join('\n')}
<g font-family="'JetBrains Mono','SF Mono',Menlo,Consolas,'DejaVu Sans Mono',monospace" font-size="14">
${texts.join('\n')}
</g>
</svg>
`;
}

/** asciicast v2, playable with `asciinema play` or the asciinema web player. */
export function toCast(recording: readonly { at: number; data: string }[], size: { cols: number; rows: number }, title: string): string {
  const header = JSON.stringify({ version: 2, width: size.cols, height: size.rows, title, env: { TERM: 'xterm-256color' } });
  return [header, ...recording.map(frame => JSON.stringify([Number((frame.at / 1000).toFixed(3)), 'o', frame.data]))].join('\n') + '\n';
}
