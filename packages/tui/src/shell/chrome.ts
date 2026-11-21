import { connectionBanner, consoleTitle, hints, type PulseCell, type PulseViewModel } from '@pi-console/viewmodels';
import { Clickable, Row, Spacer, Text, h, type Line, type Part } from '../view/renderer.ts';
import { fit, split, t } from '../view/parts.ts';
import { palette } from '../view/theme.ts';
import { contextOf, sections, type Section, type UiState } from '../state/ui.ts';
import type { Connection } from '../store/store.ts';

const labels: Record<Section, string> = {
  overview: 'Overview', fleet: 'Fleet', requests: 'Requests', questions: 'Questions', messages: 'Messages', timeline: 'Timeline', work: 'Work',
};

/** The terminal title: needs-you count, then the open session's name or the section. Sanitised by `consoleTitle`. */
export function terminalTitle(ui: Pick<UiState, 'section' | 'sessionId'>, data: { needsYou: readonly unknown[]; sessions: readonly { id: string; name: string }[] }): string {
  const session = ui.sessionId ? data.sessions.find(item => item.id === ui.sessionId) : undefined;
  return consoleTitle({ needsYou: data.needsYou.length, place: session?.name ?? labels[ui.section] });
}

export interface HeaderProps { ui: UiState; width: number; attention: number; connection: Connection; select: (section: Section) => void }

/** Brand, section tabs (clickable, number keys shown) and the attention and connection pills. */
export function Header(props: HeaderProps) {
  const { ui, connection } = props;
  const compact = props.width < 112;
  const active = ui.sessionId ? undefined : ui.section;
  const tabs = sections.map((section, index) => h(Clickable, { key: section, onClick: () => { props.select(section); } },
    h(Text, { line: section === active
      ? [t(` ${String(index + 1)} `, 'bg', { background: 'cyan', bold: true }), t(` ${labels[section]} `, 'text', { bold: true, underline: true })]
      : [t(` ${String(index + 1)} `, 'faint'), t(compact ? '' : `${labels[section]} `, 'muted')] })));
  const attention = attentionLine(props.attention, compact);
  const link: Line = connection.connected ? [t('◉ live ', 'green')] : [t('◌ offline ', 'red', { bold: true })];
  return h(Row, { background: 'raised', paddingX: 1, height: 1 },
    h(Text, { line: [t('π ', 'violet', { bold: true }), t(compact ? '' : 'console', 'text', { bold: true }), t(' ', 'faint')] }), ...tabs,
    h(Spacer, {}), h(Text, { line: attention }), h(Text, { line: link }));
}

function attentionLine(count: number, compact: boolean): Line {
  if (count === 0) return [t(compact ? '● ' : '● all clear ', 'green')];
  return [t(compact ? `! ${String(count)} ` : `● ${String(count)} need you `, 'amber', { bold: true })];
}

/** Cell height mirrors urgency, as in the web strip: needs-you, blocked and failed full, idle and done low. */
const fullCells: ReadonlySet<string> = new Set(['needs-you', 'blocked', 'failed']);
const lowCells: ReadonlySet<string> = new Set(['idle', 'done']);
const cellGlyph = (cell: PulseCell): string => (fullCells.has(cell.status.status) ? '█' : lowCells.has(cell.status.status) ? '▄' : '▆');

/** The cells that fit in `room` columns; the rest collapse into a `+N` count. */
function pulseCells(cells: readonly PulseCell[], room: number): Part[] {
  const shown = cells.length <= room ? cells : cells.slice(0, Math.max(0, room - 4));
  const more = cells.length - shown.length;
  return [...shown.map(cell => t(palette.theme === 'mono' ? cell.monoGlyph : cellGlyph(cell), cell.status.color)), ...(more > 0 ? [t(` +${String(more)}`, 'muted')] : [])];
}

/** The fleet pulse row under the tabs: one coloured cell per session, braille fleet activity when there is room, and the counts in words. */
export function pulseLine(pulse: PulseViewModel, width: number): Line {
  const counts: Part[] = [t(`${String(pulse.sessions)} sessions · ${String(pulse.working)} working`, 'muted'), ...(pulse.needsYou > 0 ? [t(` · ${String(pulse.needsYou)} need you`, 'amber', { bold: true })] : []), t(' ')];
  const activity: Part[] = [t('activity ', 'faint'), t(pulse.braille, 'cyan'), t('  ')];
  const base = width - 10 - cells(counts);
  // The session cells are the point of the row: activity only shows when every cell still fits beside it.
  const wide = base - cells(activity) >= pulse.cells.length;
  const room = wide ? base - cells(activity) : base;
  return split([t(' pulse ', 'faint'), ...pulseCells(pulse.cells, Math.max(4, room)), t('  '), ...(wide ? activity : [])], counts, width);
}

const cells = (line: readonly Part[]): number => line.reduce((sum, part) => sum + Array.from(part.text).length, 0);

/** One-line banner while the stream is down; the client reconnects on its own with capped backoff. */
export function banner(connection: Connection, width: number): Line | undefined {
  const text = connectionBanner(connection);
  if (!text) return undefined;
  return fit([t(' ⚠ ', 'bg', { background: 'amber', bold: true }), t(` ${text}`, 'amber')], width, 'raised');
}

/** The footer: the text being typed while a field is open, otherwise the shared keymap's hints for the context. */
export function footerLine(ui: UiState, width: number): Line {
  if (ui.overlay === 'filter' || ui.overlay === 'search') {
    return fit([t(ui.overlay === 'filter' ? ' / filter ' : ' / search ', 'bg', { background: 'cyan', bold: true }), t(` ${ui.input}`, 'text'), t('▌', 'cyan'), t('   ⏎ apply · esc cancel', 'faint')], width, 'raised');
  }
  const keys = hints(contextOf(ui)).map(hint => { const space = hint.indexOf(' '); return [t(hint.slice(0, space), 'cyan'), t(`${hint.slice(space)}  `, 'muted')]; });
  const notice = ui.notice ? [t(`  ${ui.notice}`, 'amber')] : [];
  return fit([t(' '), ...keys.flat(), ...notice], width, 'raised');
}
