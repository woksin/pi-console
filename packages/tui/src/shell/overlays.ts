import { keyLabel, keymapGroups, pad, paletteScopes, paletteView, settingsViewModel, themePreview, wrap, type KeymapGroup, type PaletteItem, type PaletteView, type SettingsInput, type SettingsRow, type Tone } from '@pi-console/viewmodels';
import { Column, Lines, Overlay, Panel, Row, h, type Line, type Part } from '../view/renderer.ts';
import { blank, fit, gap, heading, rule, selectable, split, t, windowOf } from '../view/parts.ts';
import type { Data } from '../store/store.ts';
import type { UiState } from '../state/ui.ts';
import { palette, type Color } from '../view/theme.ts';

const frame = (width: number, height: number, wanted: { width: number; height: number }) => {
  const w = Math.min(wanted.width, width - 2), tall = Math.min(wanted.height, height - 2);
  return { left: Math.floor((width - w) / 2), top: Math.max(1, Math.floor((height - tall) / 3)), width: w, height: tall };
};

type PaletteData = Pick<Data, 'sessions' | 'requests' | 'questions' | 'messages'>;

const paletteRow = (item: PaletteItem, width: number, selected: boolean): Line => {
  const label: Part[] = item.segments.map(segment => t(segment.text, segment.hit ? 'cyan' : 'text', segment.hit ? { bold: true, underline: true } : {}));
  const right: Part[] = [t(item.detail, 'muted'), t(item.key ? `  ${item.key}` : '', 'faint')];
  return selectable(split([t(item.glyph, item.tone, { bold: true }), gap(), ...label], right, width - 2), width, selected);
};

/** The sections as lines, with the line index of the highlighted row so the list can scroll to it. */
function paletteLines(view: PaletteView, index: number, width: number): { lines: Line[]; cursor: number } {
  const lines: Line[] = [];
  let cursor = 0;
  for (const section of view.sections) {
    lines.push([t(' '), t(section.title.toUpperCase(), 'muted', { bold: true })]);
    for (const item of section.items) {
      if (view.items.indexOf(item) === index) cursor = lines.length;
      lines.push(paletteRow(item, width, view.items.indexOf(item) === index));
    }
  }
  return { lines, cursor };
}

const paletteFooter = (view: PaletteView, width: number): Line =>
  split(paletteScopes.flatMap(scope => [t(scope.prefix, 'cyan', { bold: true }), t(` ${scope.label}  `, 'faint')]), [t(`${String(view.shown)} of ${String(view.total)}`, 'muted')], width);

/** Jump anywhere: the shared palette view model with typed groups, prefixes, match highlight and recents. */
export function Palette(props: { ui: UiState; data: PaletteData; width: number; height: number }) {
  const box = frame(props.width, props.height, { width: 96, height: 26 });
  const inner = box.width - 4;
  const view = paletteView({ ...props.data, query: props.ui.input, recents: props.ui.recents, client: 'tui' });
  const index = Math.min(props.ui.paletteIndex, Math.max(0, view.items.length - 1));
  const prompt: Line = fit([t('❯ ', 'cyan', { bold: true }), t(props.ui.input, 'text'), t('▌', 'cyan')], inner, 'panel');
  const { lines, cursor } = paletteLines(view, index, inner);
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

export function Help(props: { width: number; height: number }) {
  const width = Math.min(116, props.width - 2);
  const column = Math.floor((width - 6) / 2);
  const groups = keymapGroups('tui');
  const left = helpLines(groups.slice(0, 2), column);
  const right = helpLines(groups.slice(2), column);
  const box = frame(props.width, props.height, { width, height: Math.max(left.length, right.length) + 5 });
  return h(Overlay, box, h(Panel, { title: 'Help', right: '? or esc closes', focused: true, grow: 1, background: 'raised' },
    h(Lines, { lines: [heading('Keyboard map (shared with the web console)'), blank], height: 2 }),
    h(Row, { grow: 1, gap: 2 }, h(Column, { width: column }, h(Lines, { lines: left, grow: 1 })), h(Column, { width: column }, h(Lines, { lines: right, grow: 1 }))),
    h(Lines, { lines: [[t('Read-only: nothing here can change a session.', 'faint')]], height: 1 })));
}

const tone: Record<Tone, Color> = { good: 'green', warn: 'amber', bad: 'red', plain: 'text' };
const section = (title: string, rows: SettingsRow[]): Line[] => [heading(title), ...rows.map((row): Line => [t(row.label.padEnd(18), 'muted'), t(row.value, tone[row.tone])]), blank];

/** The same samples the web Settings shows, in the theme this terminal is drawing with. */
function themeLines(): Line[] {
  const preview = themePreview();
  return [heading('Theme'),
    [t('Theme'.padEnd(18), 'muted'), t(palette.theme, 'text', { bold: true }), t('  PI_CONSOLE_THEME=midnight|contrast|mono', 'faint')],
    preview.statuses.flatMap((sample, index) => [...(index ? [t('  ')] : []), t(sample.text, sample.color)]),
    [...preview.text.flatMap(sample => [t(sample.text, sample.color), t('  ')]), ...preview.ramp.map(value => t('██', `pressure:${value}` as const)), t(' context ramp', 'faint')],
    blank];
}

export function Settings(props: { input: SettingsInput; width: number; height: number }) {
  const box = frame(props.width, props.height, { width: 76, height: 27 });
  const model = settingsViewModel(props.input);
  const lines = [...section('Health', model.health), ...section('Data', model.data), ...section('Sources', model.sources), ...themeLines()];
  return h(Overlay, box, h(Panel, { title: 'Settings', right: 'esc closes', focused: true, grow: 1, background: 'raised' }, h(Lines, { lines, grow: 1 })));
}
