import { activeBindings, paletteItems, settingsViewModel, type SettingsInput, type SettingsRow, type Tone } from '@pi-console/viewmodels';
import { Lines, Overlay, Panel, h, type Line } from '../view/renderer.ts';
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

export function Help(props: { width: number; height: number }) {
  const box = frame(props.width, props.height, { width: 76, height: Math.min(props.height - 2, activeBindings.length + 8) });
  const lines: Line[] = [heading('Keyboard map (shared with the web console)'), blank,
    ...activeBindings.map((binding): Line => [t(binding.keys.join(' ').padEnd(20), 'cyan'), t(binding.label, 'text')]), blank, [t('Read-only: nothing here can change a session.', 'faint')]];
  return h(Overlay, box, h(Panel, { title: 'Help', right: '? or esc closes', focused: true, grow: 1, background: 'raised' }, h(Lines, { lines, grow: 1 })));
}

const tone: Record<Tone, Color> = { good: 'green', warn: 'amber', bad: 'red', plain: 'text' };
const section = (title: string, rows: SettingsRow[]): Line[] => [heading(title), ...rows.map((row): Line => [t(row.label.padEnd(18), 'muted'), t(row.value, tone[row.tone])]), blank];

export function Settings(props: { input: SettingsInput; width: number; height: number }) {
  const box = frame(props.width, props.height, { width: 76, height: 22 });
  const model = settingsViewModel(props.input);
  const lines = [...section('Health', model.health), ...section('Data', model.data), ...section('Sources', model.sources)];
  return h(Overlay, box, h(Panel, { title: 'Settings', right: 'esc closes', focused: true, grow: 1, background: 'raised' }, h(Lines, { lines, grow: 1 })));
}
