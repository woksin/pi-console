import { keyLabel, keymapGroups, pad, paletteItems, settingsViewModel, wrap, type KeymapGroup, type SettingsInput, type SettingsRow, type Tone } from '@pi-console/viewmodels';
import { Column, Lines, Overlay, Panel, Row, h, type Line } from '../view/renderer.ts';
import { blank, fit, heading, selectable, t } from '../view/parts.ts';
import type { Data } from '../store/store.ts';
import type { UiState } from '../state/ui.ts';
import type { Color } from '../view/theme.ts';

const frame = (width: number, height: number, wanted: { width: number; height: number }) => {
  const w = Math.min(wanted.width, width - 2), tall = Math.min(wanted.height, height - 2);
  return { left: Math.floor((width - w) / 2), top: Math.max(1, Math.floor((height - tall) / 3)), width: w, height: tall };
};

export function Palette(props: { ui: UiState; data: Data; width: number; height: number }) {
  const box = frame(props.width, props.height, { width: 72, height: 16 });
  const inner = box.width - 4;
  const items = paletteItems({ sessions: props.data.sessions, query: props.ui.input });
  const index = Math.min(props.ui.paletteIndex, Math.max(0, items.length - 1));
  const rows: Line[] = items.length === 0 ? [[t('  Nothing matches. Prefix > for commands, @ for sessions.', 'muted')]]
    : items.map((item, at) => selectable([t(item.group === 'Command' ? '› ' : '◆ ', item.group === 'Command' ? 'cyan' : 'violet'), t(item.label, 'text'), t(item.detail ? `  ${item.detail}` : '', 'faint'), t(item.key ? `  [${item.key}]` : '', 'muted')], inner, at === index));
  const prompt: Line = fit([t('❯ ', 'cyan', { bold: true }), t(props.ui.input, 'text'), t('▌', 'cyan')], inner, 'panel');
  return h(Overlay, box, h(Panel, { title: 'Command palette', right: '↑↓ choose · ⏎ run · esc close', focused: true, grow: 1, background: 'raised' }, h(Lines, { lines: [prompt, blank, ...rows], grow: 1 })));
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

export function Settings(props: { input: SettingsInput; width: number; height: number }) {
  const box = frame(props.width, props.height, { width: 76, height: 22 });
  const model = settingsViewModel(props.input);
  const lines = [...section('Health', model.health), ...section('Data', model.data), ...section('Sources', model.sources)];
  return h(Overlay, box, h(Panel, { title: 'Settings', right: 'esc closes', focused: true, grow: 1, background: 'raised' }, h(Lines, { lines, grow: 1 })));
}
