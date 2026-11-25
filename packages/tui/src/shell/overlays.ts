import { keyLabel, keymapGroups, pad, paletteScopes, paletteView, healthGroups, displayWidth, settingsViewModel, themePreview, wrap, type KeymapGroup, type PaletteItem, type PaletteView, type SettingsInput, type SettingsRow, type Tone, type TextWidth } from '@pi-console/viewmodels';
import { Lines, Overlay, Panel, h, useTextWidth, type Line, type Part } from '../view/renderer.ts';
import { blank, fit, gap, heading, rule, selectable, split, t, windowOf } from '../view/parts.ts';
import type { Data } from '../store/store.ts';
import type { UiState } from '../state/ui.ts';
import { palette, type Color } from '../view/theme.ts';

export const frame = (width: number, height: number, wanted: { width: number; height: number }) => {
  const w = Math.min(wanted.width, width - 2), tall = Math.min(wanted.height, height - 2);
  return { left: Math.floor((width - w) / 2), top: Math.max(1, Math.floor((height - tall) / 3)), width: w, height: tall };
};

type PaletteData = Pick<Data, 'sessions' | 'requests' | 'questions' | 'messages'>;

const paletteRow = (item: PaletteItem, width: number, selected: boolean, measure: TextWidth): Line => {
  const label: Part[] = item.segments.map(segment => t(segment.text, segment.hit ? 'cyan' : 'text', segment.hit ? { bold: true, underline: true } : {}));
  const right: Part[] = [t(item.detail, 'muted'), t(item.key ? `  ${item.key}` : '', 'faint')];
  return selectable(split([t(item.glyph, item.tone, { bold: true }), gap(), ...label], right, width - 2, { measure }), width, selected, { measure });
};

/** The sections as lines, with the line index of the highlighted row so the list can scroll to it. */
function paletteLines(view: PaletteView, index: number, width: number, measure: TextWidth): { lines: Line[]; cursor: number } {
  const lines: Line[] = [];
  let cursor = 0;
  for (const section of view.sections) {
    lines.push([t(' '), t(section.title.toUpperCase(), 'muted', { bold: true })]);
    for (const item of section.items) {
      if (view.items.indexOf(item) === index) cursor = lines.length;
      lines.push(paletteRow(item, width, view.items.indexOf(item) === index, measure));
    }
  }
  return { lines, cursor };
}

const paletteFooter = (view: PaletteView, width: number): Line =>
  split(paletteScopes.flatMap(scope => [t(scope.prefix, 'cyan', { bold: true }), t(` ${scope.label}  `, 'faint')]), [t(`${String(view.shown)} of ${String(view.total)}`, 'muted')], width);

/** Jump anywhere: the shared palette view model with typed groups, prefixes, match highlight and recents. */
export function Palette(props: { ui: UiState; data: PaletteData; width: number; height: number }) {
  const measure = useTextWidth();
  const box = frame(props.width, props.height, { width: 96, height: 26 });
  const inner = box.width - 4;
  const view = paletteView({ ...props.data, query: props.ui.input, recents: props.ui.recents, client: 'tui' });
  const index = Math.min(props.ui.paletteIndex, Math.max(0, view.items.length - 1));
  const prompt: Line = fit([t('❯ ', 'cyan', { bold: true }), t(props.ui.input, 'text'), t('▌', 'cyan')], inner, 'panel', measure);
  const { lines, cursor } = paletteLines(view, index, inner, measure);
  const room = Math.max(1, box.height - 6);
  const shown = windowOf(lines.length, cursor, room);
  const body = view.items.length === 0 ? [[t(`  No matches in ${view.scope}. Try another word or prefix.`, 'muted')]] : lines.slice(shown.start, shown.end);
  return h(Overlay, box, h(Panel, { title: 'Command palette', right: '↑↓ choose · ⏎ open · esc close', focused: true, grow: 1, background: 'raised' },
    h(Lines, { lines: [prompt, rule(inner)], height: 2 }), h(Lines, { lines: body, grow: 1 }), h(Lines, { lines: [paletteFooter(view, inner)], height: 1 })));
}

function helpLines(groups: KeymapGroup[], width: number): Line[] {
  return groups.flatMap(group => [heading(group.title), ...group.bindings.flatMap(binding => {
    const keys = binding.keys.map(keyLabel).join(' ');
    return wrap(binding.label, Math.max(1, width - 15)).map((label, index): Line => [t(pad(index === 0 ? keys : '', 15), 'cyan'), t(label, 'text')]);
  }), blank]);
}

const safetyText = 'Ordinary access is read-only. Opt-in memory review only requests a review; a human must confirm it in pi. The console never writes memory directly.';

function helpContent({ width }: { width: number }): Line[] {
  const groups = keymapGroups('tui');
  const safety: Line[] = [...wrap(safetyText, width - 4).map((text): Line => [t(text, 'muted')]), blank];
  if (width < 100) return [...safety, ...helpLines(groups, width - 4)];
  const column = Math.floor((width - 6) / 2);
  const left = helpLines(groups.slice(0, 2), column), right = helpLines(groups.slice(2), column);
  return [...safety, ...Array.from({ length: Math.max(left.length, right.length) }, (_, index) => [...fit(left[index] ?? [], column), gap(2), ...fit(right[index] ?? [], column)])];
}

function overlayViewport(size: { width: number; height: number }, lines: Line[], wanted: { width: number; height: number }, reserved = 2) {
  const box = frame(size.width, size.height, wanted);
  const page = Math.max(1, box.height - reserved);
  return { lines, box, bounds: { page, max: Math.max(0, lines.length - page) } };
}

function visibleViewport({ lines, bounds }: ReturnType<typeof overlayViewport>, scroll = 0) {
  const start = Math.max(0, Math.min(scroll, bounds.max));
  const position = bounds.max > 0 ? `${String(start + 1)}–${String(Math.min(lines.length, start + bounds.page))} of ${String(lines.length)} · ↑↓ PgUp/PgDn Home/End · ` : '';
  return { lines: lines.slice(start, start + bounds.page), position };
}

export function helpViewport(size: { width: number; height: number }) {
  const wanted = Math.min(116, size.width - 2);
  const lines = helpContent({ width: wanted });
  return overlayViewport(size, lines, { width: wanted, height: lines.length + 4 }, 4);
}

export function Help(props: { width: number; height: number; scroll?: number }) {
  const viewport = helpViewport(props);
  const { lines, position } = visibleViewport(viewport, props.scroll);
  return h(Overlay, viewport.box, h(Panel, { title: 'Help', right: `${position}? or esc closes`, focused: true, grow: 1, background: 'raised' },
    h(Lines, { lines: [heading('Keyboard map (shared with the web console)'), blank], height: 2 }),
    h(Lines, { lines, grow: 1 })));
}

const tone: Record<Tone, Color> = { good: 'green', warn: 'amber', bad: 'red', plain: 'text' };
interface SettingsColumn { labelWidth: number; valueWidth: number }

/** Value and detail facts are packed whole into the column, so a wrap never leaves a ` · ` separator at either end of a line. */
function settingsValues(row: SettingsRow, { valueWidth }: SettingsColumn): Line[] {
  const segments = [
    ...row.value.split(' · ').map(text => ({ text, color: tone[row.tone] })),
    ...(row.valueDetail ?? '').split(' · ').filter(text => text !== '').map(text => ({ text, color: 'faint' as const })),
  ];
  const lines: Part[][] = [];
  let used = 0;
  for (const segment of segments) {
    const wrapped = wrap(segment.text, valueWidth);
    const last = lines.at(-1);
    if (last && used + 3 + displayWidth(wrapped[0] ?? '') <= valueWidth && wrapped.length === 1) {
      last.push(t(' · ', segment.color), t(wrapped[0], segment.color));
      used += 3 + displayWidth(wrapped[0]);
      continue;
    }
    lines.push(...wrapped.map((text): Part[] => [t(text, segment.color)]));
    used = displayWidth(wrapped.at(-1) ?? '');
  }
  return lines.length === 0 ? [[t('', tone[row.tone])]] : lines;
}

/** Labels and values wrap independently, keeping every value continuation in the shared column. */
function settingsLine(row: SettingsRow, column: SettingsColumn): Line[] {
  const labels = wrap(row.label, column.labelWidth);
  return [
    ...labels.slice(0, -1).map((label): Line => [t(`${pad(label, column.labelWidth)}  `, 'muted')]),
    ...settingsValues(row, column).map((value, index): Line => [t(`${pad(index === 0 ? labels.at(-1) ?? '' : '', column.labelWidth)}  `, 'muted'), ...value]),
    ...row.detail ? wrap(row.detail, column.labelWidth + column.valueWidth).map((detail): Line => [t(`  ${detail}`, 'faint')]) : [],
  ];
}

const section = ({ title, rows }: { title: string; rows: SettingsRow[] }, column: SettingsColumn): Line[] => [heading(title), ...rows.flatMap(row => settingsLine(row, column)), blank];

/** The same samples the web Settings shows, in the theme this terminal is drawing with. */
function themeLines(column: SettingsColumn): Line[] {
  const preview = themePreview();
  return [heading('Theme'),
    ...settingsLine({ label: 'Theme', value: palette.theme, valueDetail: 'PI_CONSOLE_THEME=midnight|contrast|mono', tone: 'plain' }, column),
    preview.statuses.flatMap((sample, index) => [...(index ? [t('  ')] : []), t(sample.text, sample.color)]),
    [...preview.text.flatMap(sample => [t(sample.text, sample.color), t('  ')]), ...preview.ramp.map(value => t('██', `pressure:${value}` as const)), t(' context ramp', 'faint')],
    blank];
}

export function settingsViewport(size: { width: number; height: number }, input: SettingsInput, health: Record<string, unknown> | null = null) {
  const reported = input.daemonHealth ?? health;
  const model = settingsViewModel({ ...input, daemonHealth: reported });
  const groups = [{ title: 'Health', rows: model.health }, ...healthGroups(reported, model.sources, input.now), { title: 'Data', rows: model.data }];
  const longest = Math.max(5, ...groups.flatMap(group => group.rows.map(row => displayWidth(row.label))));
  const wanted = { width: 76, height: 27 };
  const inner = frame(size.width, size.height, wanted).width - 4; // Panel borders and horizontal padding.
  const labelWidth = Math.max(5, Math.min(longest, 32, Math.floor((inner - 2) / 2)));
  const column: SettingsColumn = { labelWidth, valueWidth: Math.max(1, inner - labelWidth - 2) };
  const lines = [...groups.flatMap(group => section(group, column)), ...themeLines(column)];
  return overlayViewport(size, lines, wanted);
}

export function Settings(props: { input: SettingsInput; health?: Record<string, unknown> | null; width: number; height: number; scroll?: number }) {
  const viewport = settingsViewport(props, props.input, props.health);
  const { lines, position } = visibleViewport(viewport, props.scroll);
  return h(Overlay, viewport.box, h(Panel, { title: 'Settings', right: `${position}esc closes`, focused: true, grow: 1, background: 'raised' }, h(Lines, { lines, grow: 1 })));
}
