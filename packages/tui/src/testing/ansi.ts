import type { Terminal } from '@xterm/headless';

type Cell = NonNullable<ReturnType<NonNullable<ReturnType<Terminal['buffer']['active']['getLine']>>['getCell']>>;

const colourCodes = (cell: Cell, foreground: boolean): string => {
  const isRgb = foreground ? cell.isFgRGB() : cell.isBgRGB();
  const isPalette = foreground ? cell.isFgPalette() : cell.isBgPalette();
  const value = foreground ? cell.getFgColor() : cell.getBgColor();
  const base = foreground ? 38 : 48;
  if (isRgb) return `${String(base)};2;${String((value >> 16) & 255)};${String((value >> 8) & 255)};${String(value & 255)}`;
  return isPalette ? `${String(base)};5;${String(value)}` : '';
};

/** The SGR sequence that sets exactly the attributes of a cell, starting from a reset. */
function sgrOf(cell: Cell): string {
  const codes = [cell.isBold() ? '1' : '', cell.isDim() ? '2' : '', cell.isItalic() ? '3' : '', cell.isUnderline() ? '4' : '', cell.isInverse() ? '7' : '', colourCodes(cell, true), colourCodes(cell, false)];
  return `\u001b[0${codes.filter(Boolean).map(code => `;${code}`).join('')}m`;
}

/** One screen row as text with colour escapes, trailing blanks removed. */
function rowToAnsi(line: NonNullable<ReturnType<Terminal['buffer']['active']['getLine']>>, cols: number): string {
  let text = '';
  let kept = 0;
  let style = '';
  for (let column = 0; column < cols; column++) {
    const cell = line.getCell(column);
    if (!cell || cell.getWidth() === 0) continue;
    const next = sgrOf(cell);
    if (next !== style) { text += next; style = next; }
    const chars = cell.getChars() || ' ';
    text += chars;
    if (chars !== ' ') kept = text.length;
  }
  return text.slice(0, kept) + '\u001b[0m';
}

/** Clears the player screen and repaints the emulator's visible screen with its colours; deterministic for a settled screen. */
export function screenToAnsi(terminal: Terminal): string {
  const rows: string[] = [];
  for (let row = 0; row < terminal.rows; row++) {
    const line = terminal.buffer.active.getLine(row);
    rows.push(line ? rowToAnsi(line, terminal.cols) : '');
  }
  return `\u001b[2J\u001b[H${rows.join('\r\n')}`;
}
