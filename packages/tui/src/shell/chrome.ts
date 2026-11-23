import { connectionBanner, consoleTitle, displayWidth, hints, type PulseCell, type PulseViewModel } from '@pi-console/viewmodels';
import { Clickable, Row, Spacer, Text, h, type Line, type Part } from '../view/renderer.ts';
import { fit, split, t } from '../view/parts.ts';
import { palette } from '../view/theme.ts';
import { contextOf, sections, type Section, type UiState } from '../state/ui.ts';
import type { Connection, Data } from '../store/store.ts';

const labels: Record<Section, string> = {
  overview: 'Overview', fleet: 'Fleet', requests: 'Requests', questions: 'Questions', messages: 'Messages', timeline: 'Timeline', work: 'Work',
};

/** The terminal title: needs-you count, then the open session's name or the section. Sanitised by `consoleTitle`. */
export function terminalTitle(ui: Pick<UiState, 'section' | 'sessionId'>, data: { needsYou: readonly unknown[]; sessions: readonly { id: string; name: string }[] }): string {
  const session = ui.sessionId ? data.sessions.find(item => item.id === ui.sessionId) : undefined;
  return consoleTitle({ needsYou: data.needsYou.length, place: session?.name ?? labels[ui.section] });
}

type Attention = Pick<Data, 'needsYou' | 'needsYouLoaded' | 'needsYouError' | 'needsYouCached'>;
export interface HeaderProps { ui: UiState; width: number; attention: Attention; connection: Connection; select: (section: Section) => void }

const activeSection = (ui: UiState): Section | undefined => ui.sessionId ? undefined : ui.section;
const tabsWidth = (tabs: { line: Line }[]): number => tabs.reduce((sum, tab) => sum + cells(tab.line), 0);

function headerNavigation(ui: UiState, compact: boolean) {
  const active = activeSection(ui);
  const brand = [t('π ', 'violet', { bold: true }), t(compact ? '' : 'console', 'text', { bold: true }), t(' ', 'faint')];
  const tabs = sections.map((section, index) => ({ section, line: section === active
    ? [t(` ${String(index + 1)} `, 'bg', { background: 'cyan', bold: true }), t(` ${labels[section]} `, 'text', { bold: true, underline: true })]
    : [t(` ${String(index + 1)} `, 'faint'), t(compact ? '' : `${labels[section]} `, 'muted')] }));
  return { brand, tabs, width: cells(brand) + tabsWidth(tabs) };
}

/** Inactive tabs and then the brand give way before the attention pill. */
function navigationWithin(ui: UiState, navigation: ReturnType<typeof headerNavigation>, room: number) {
  let { brand, tabs } = navigation;
  if (navigation.width > room) tabs = tabs.filter(tab => tab.section === activeSection(ui));
  if (cells(brand) + tabsWidth(tabs) > room) brand = [];
  const fittedTabs = tabs.map(tab => ({ ...tab, line: fit(tab.line, Math.min(room, cells(tab.line))) }));
  return { brand, tabs: fittedTabs };
}

function headerLayout(props: HeaderProps) {
  const link: Line = props.connection.connected ? [t('◉ live ', 'green')] : [t('◌ offline ', 'red', { bold: true })];
  const full = headerNavigation(props.ui, false);
  const compact = props.width < 112 || full.width + cells(attentionLine(props.attention, false)) + cells(link) + 2 > props.width;
  const preferred = compact ? headerNavigation(props.ui, true) : full;
  const wantedAttention = attentionLine(props.attention, compact);
  const attention = fit(wantedAttention, Math.min(Math.max(0, props.width - 2), cells(wantedAttention)));
  const room = Math.max(0, props.width - cells(attention) - 2);
  const visibleLink = preferred.width + cells(link) <= room ? link : [];
  return { navigation: navigationWithin(props.ui, preferred, room - cells(visibleLink)), attention, link: visibleLink };
}

/** Brand, section tabs (clickable, number keys shown) and the attention and connection pills. */
export function Header(props: HeaderProps) {
  const { navigation, attention, link } = headerLayout(props);
  const tabs = navigation.tabs.map(tab => h(Clickable, { key: tab.section, onClick: () => { props.select(tab.section); } }, h(Text, { line: tab.line })));
  return h(Row, { background: 'raised', paddingX: 1, height: 1 },
    h(Text, { line: navigation.brand }), ...tabs,
    h(Spacer, {}), h(Text, { line: attention }), h(Text, { line: link }));
}

function attentionLine(attention: Attention, compact: boolean): Line {
  if (!attention.needsYouLoaded || attention.needsYouError) return unavailableAttention(attention, compact);
  const count = attention.needsYou.length;
  if (count === 0) return [t(compact ? '● ' : '● all clear ', 'green')];
  return [t(compact ? `! ${String(count)} ` : `● ${String(count)} need you `, 'amber', { bold: true })];
}

function unavailableAttention(attention: Attention, compact: boolean): Line {
  if (attention.needsYouCached) return [t(compact ? `! ${String(attention.needsYou.length)} stale ` : `● ${String(attention.needsYou.length)} need you · stale `, 'muted', { dim: true })];
  if (attention.needsYouError) return [t(compact ? '! unavailable ' : '⚠ attention unavailable ', 'amber')];
  return [t('checking… ', 'muted', { dim: true })];
}

/** Cell height mirrors urgency, as in the web strip: needs-you, blocked and failed full, idle and done low. */
const fullCells: ReadonlySet<string> = new Set(['needs-you', 'blocked', 'failed']);
const lowCells: ReadonlySet<string> = new Set(['idle', 'done']);
const cellGlyph = (cell: PulseCell): string => (fullCells.has(cell.status.status) ? '█' : lowCells.has(cell.status.status) ? '▄' : '▆');

/** The cells that fit in `room` columns; the rest collapse into a `+N` count. */
function pulseCells(cells: readonly PulseCell[], room: number): Part[] {
  const shown = cells.length <= room ? cells : cells.slice(0, Math.max(0, room - 4));
  const more = cells.slice(shown.length).reduce((sum, cell) => sum + cell.count, 0);
  return [...shown.map(cell => t(palette.theme === 'mono' ? cell.monoGlyph : cellGlyph(cell), cell.status.color)), ...(more > 0 ? [t(` +${String(more)}`, 'muted')] : [])];
}

/** Bounded status runs under the tabs, braille fleet activity when there is room, and counts in words. */
export function pulseLine(pulse: PulseViewModel, width: number): Line {
  const counts: Part[] = [t(`${String(pulse.sessions)} sessions · ${String(pulse.working)} working`, 'muted'), t(' ')];
  const activity: Part[] = [t('activity ', 'faint'), t(pulse.braille, 'cyan'), t('  ')];
  const base = width - 10 - cells(counts);
  // The session cells are the point of the row: activity only shows when every cell still fits beside it.
  const wide = base - cells(activity) >= pulse.cells.length;
  const room = wide ? base - cells(activity) : base;
  return split([t(' pulse ', 'faint'), ...pulseCells(pulse.cells, Math.max(4, room)), t('  '), ...(wide ? activity : [])], counts, width);
}

const cells = (line: readonly Part[]): number => displayWidth(line.map(part => part.text).join(''));

const bannerWarningCells = 4;
/** Columns kept for the endpoint when the banner text has to give up the as-of time to show the error. */
const endpointCells = 12;

/** One-line banner while the stream is down, with the last error; the client reconnects on its own with capped backoff. */
export function banner(connection: Connection, width: number, endpoint?: string): Line | undefined {
  const text = connectionBanner(connection, width - bannerWarningCells - (endpoint ? endpointCells : 0));
  if (!text) return undefined;
  const warning = [t(' ⚠ ', 'bg', { background: 'amber', bold: true }), t(' ', 'amber')];
  const status = [t(text, 'amber')];
  return endpoint
    ? split([...warning, t(endpoint, 'amber')], status, width, 'raised')
    : fit([...warning, ...status], width, 'raised');
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
