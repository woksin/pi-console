import type { Session } from '@pi-console/contract';
import { fuzzy } from '../format/format.ts';
import type { Action } from '../keymap/keymap.ts';

export type PaletteTarget = { kind: 'action'; action: Action } | { kind: 'session'; sessionId: string };
export interface PaletteItem { id: string; group: 'Command' | 'Session'; label: string; detail: string; key: string; target: PaletteTarget }

const commands: readonly { label: string; action: Action; key: string }[] = [
  { label: 'Go to Overview', action: 'section.1', key: '1' }, { label: 'Go to Fleet', action: 'section.2', key: '2' },
  { label: 'Go to Requests', action: 'section.3', key: '3' }, { label: 'Go to Questions', action: 'section.4', key: '4' },
  { label: 'Go to Messages', action: 'section.5', key: '5' }, { label: 'Go to Timeline', action: 'section.6', key: '6' },
  { label: 'Go to Work', action: 'section.7', key: '7' }, { label: 'Open settings', action: 'settings.open', key: ',' },
  { label: 'Show help', action: 'help.toggle', key: '?' }, { label: 'Toggle messages list or graph', action: 'view.toggle', key: 'v' },
  { label: 'Quit', action: 'quit', key: 'Ctrl+C' },
];

/** Prefixes: `>` commands only, `@` sessions only. Plain text searches both; sessions rank after commands. */
export function paletteItems(input: { sessions: readonly Session[]; query: string }): PaletteItem[] {
  const prefix = input.query[0];
  const text = prefix === '>' || prefix === '@' ? input.query.slice(1).trim() : input.query.trim();
  const wantCommands = prefix !== '@';
  const wantSessions = prefix !== '>';
  const items: PaletteItem[] = [
    ...(wantCommands ? commands.map(command => ({ id: `cmd:${command.action}`, group: 'Command' as const, label: command.label, detail: '', key: command.key, target: { kind: 'action' as const, action: command.action } })) : []),
    ...(wantSessions ? input.sessions.map(session => ({ id: `session:${session.id}`, group: 'Session' as const, label: session.name, detail: `${session.repositoryId}/${session.laneId} · ${session.status}`, key: '', target: { kind: 'session' as const, sessionId: session.id } })) : []),
  ];
  if (!text) return items.slice(0, 12);
  return items.flatMap(item => { const score = fuzzy(text, `${item.label} ${item.detail}`); return score === undefined ? [] : [{ item, score }]; })
    .sort((a, b) => a.score - b.score).slice(0, 12).map(entry => entry.item);
}
