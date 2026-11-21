import { statusToken, type Message, type Question, type Request, type Session, type ThemeToken } from '@pi-console/contract';
import { clip } from '../format/format.ts';
import { glyphs } from '../format/glyphs.ts';
import { laneLabel } from '../format/lane-label.ts';
import { bindingsFor, type Action, type KeyClient } from '../keymap/keymap.ts';
import { matchQuery, segments, type MatchSegment } from './match.ts';

export type { MatchRange, MatchSegment } from './match.ts';
export { matchQuery, segments } from './match.ts';

export type PaletteTarget = { kind: 'action'; action: Action } | { kind: 'session'; sessionId: string; entryId?: string | null };
export type PaletteGroup = 'Command' | 'Session' | 'Lane' | 'Question' | 'Request' | 'Message';

/** One result: a status glyph and colour on every row, the label split into highlighted runs, and where it leads. */
export interface PaletteItem {
  id: string; group: PaletteGroup; label: string; detail: string; key: string;
  glyph: string; tone: ThemeToken; status: string; segments: MatchSegment[]; target: PaletteTarget;
}
export interface PaletteSection { title: string; items: PaletteItem[] }
/** Sections in display order; `items` is the same rows flattened, which is the keyboard order. */
export interface PaletteView { scope: string; sections: PaletteSection[]; items: PaletteItem[]; shown: number; total: number }

export interface PaletteInput {
  query: string; sessions: readonly Session[];
  requests?: readonly Request[]; questions?: readonly Question[]; messages?: readonly Message[];
  /** Item ids picked before, newest first. */
  recents?: readonly string[]; client?: KeyClient;
}

/** Typed prefixes, shown in the palette footer of both clients. */
export const paletteScopes = [
  { prefix: '>', label: 'commands', groups: ['Command'] }, { prefix: '@', label: 'sessions, lanes', groups: ['Session', 'Lane'] },
  { prefix: '#', label: 'questions, requests', groups: ['Question', 'Request'] }, { prefix: '/', label: 'messages', groups: ['Message'] },
] as const satisfies readonly { prefix: string; label: string; groups: readonly PaletteGroup[] }[];

const groupOrder: readonly PaletteGroup[] = ['Command', 'Session', 'Lane', 'Question', 'Request', 'Message'];
const titles: Record<PaletteGroup, string> = { Command: 'Commands', Session: 'Sessions', Lane: 'Lanes', Question: 'Questions', Request: 'Requests', Message: 'Messages' };
const perGroup = 6;
const limit = 14;

const commands: readonly { label: string; action: Action; key: string }[] = [
  { label: 'Go to Overview', action: 'section.1', key: '1' }, { label: 'Go to Fleet', action: 'section.2', key: '2' },
  { label: 'Go to Requests', action: 'section.3', key: '3' }, { label: 'Go to Questions', action: 'section.4', key: '4' },
  { label: 'Go to Messages', action: 'section.5', key: '5' }, { label: 'Go to Timeline', action: 'section.6', key: '6' },
  { label: 'Go to Work', action: 'section.7', key: '7' }, { label: 'Open settings', action: 'settings.open', key: ',' },
  { label: 'Show help', action: 'help.toggle', key: '?' }, { label: 'Toggle messages list or graph', action: 'view.toggle', key: 'v' },
  { label: 'Quit', action: 'quit', key: 'Ctrl+C' },
];

/** Session badge precedence (docs/information-architecture.md section 2). */
const precedence = ['needs-you', 'blocked', 'failed', 'working', 'waiting', 'idle', 'done'];
const severity = (status: string): number => { const at = precedence.indexOf(status); return at < 0 ? precedence.length : at; };
const oneLine = (text: string): string => clip(text, 160);

type Candidate = Omit<PaletteItem, 'segments'>;

const statusFields = (status: string): Pick<Candidate, 'glyph' | 'tone' | 'status'> => {
  const token = statusToken(status);
  return { glyph: token.glyph, tone: token.color, status: token.label };
};

function commandCandidates(client: KeyClient): Candidate[] {
  const available = new Set(bindingsFor(client).map(binding => binding.action));
  return commands.filter(command => available.has(command.action)).map(command => ({
    id: `cmd:${command.action}`, group: 'Command', label: command.label, detail: '', key: command.key,
    glyph: '›', tone: 'muted', status: 'Command', target: { kind: 'action', action: command.action },
  }));
}

const sessionCandidate = (session: Session): Candidate => ({
  id: `session:${session.id}`, group: 'Session', label: session.name, detail: laneLabel(session.repositoryId, session.laneId), key: '',
  ...statusFields(session.status), target: { kind: 'session', sessionId: session.id },
});

/** A lane opens its newest top-level session; its badge is the most urgent status of any session in it. */
function laneCandidates(sessions: readonly Session[]): Candidate[] {
  const lanes = new Map<string, Session[]>();
  for (const session of sessions) {
    const key = laneLabel(session.repositoryId, session.laneId);
    lanes.set(key, [...(lanes.get(key) ?? []), session]);
  }
  return [...lanes].map(([label, members]) => {
    const lead = [...members].sort((a, b) => Number(a.role === 'subagent') - Number(b.role === 'subagent') || b.updatedAt.localeCompare(a.updatedAt))[0];
    const worst = [...members].sort((a, b) => severity(a.status) - severity(b.status))[0];
    return {
      id: `lane:${label}`, group: 'Lane', label, detail: `${String(members.length)} session${members.length === 1 ? '' : 's'}`, key: '',
      ...statusFields(worst.status), target: { kind: 'session', sessionId: lead.id },
    };
  });
}

function entityCandidates(input: PaletteInput, names: ReadonlyMap<string, string>): Candidate[] {
  const name = (id: string): string => names.get(id) ?? id;
  return [
    ...(input.questions ?? []).map((question): Candidate => ({
      id: `question:${question.id}`, group: 'Question', label: oneLine(question.text), detail: `${name(question.sessionId)} · ${question.kind}`, key: '',
      glyph: glyphs.question, tone: question.status === 'open' ? 'amber' : 'faint', status: question.status === 'open' ? 'Open' : 'Closed',
      target: { kind: 'session', sessionId: question.sessionId },
    })),
    ...(input.requests ?? []).map((request): Candidate => ({
      id: `request:${request.id}`, group: 'Request', label: oneLine(request.text), detail: name(request.sessionId), key: '',
      ...statusFields(request.status), target: { kind: 'session', sessionId: request.sessionId, entryId: request.pointer?.entryId ?? null },
    })),
    ...(input.messages ?? []).map((message): Candidate => ({
      id: `message:${message.id}`, group: 'Message', label: oneLine(message.text), detail: `${name(message.fromSessionId)} → ${name(message.toSessionId)}`, key: '',
      glyph: glyphs.message, tone: 'cyan', status: 'Message', target: { kind: 'session', sessionId: message.fromSessionId },
    })),
  ];
}

function candidates(input: PaletteInput): Candidate[] {
  const sessions = [...input.sessions].sort((a, b) => severity(a.status) - severity(b.status));
  const names = new Map(input.sessions.map(session => [session.id, session.name]));
  return [...commandCandidates(input.client ?? 'tui'), ...sessions.map(sessionCandidate), ...laneCandidates(sessions), ...entityCandidates(input, names)];
}

function parseQuery(query: string): { text: string; scope: (typeof paletteScopes)[number] | undefined } {
  const scope = paletteScopes.find(entry => query.startsWith(entry.prefix));
  return { text: (scope ? query.slice(1) : query).trim(), scope };
}

const plain = (item: Candidate): PaletteItem => ({ ...item, segments: [{ text: item.label, hit: false }] });

function section(group: PaletteGroup, items: PaletteItem[]): PaletteSection {
  return { title: titles[group], items };
}

/** Empty query: recent picks first, then commands, then a few sessions (most urgent first). */
function browse(pool: Candidate[], recents: readonly string[]): PaletteSection[] {
  const byId = new Map(pool.map(item => [item.id, item]));
  const recent = recents.flatMap(id => { const item = byId.get(id); return item ? [plain(item)] : []; }).slice(0, 5);
  const seen = new Set(recent.map(item => item.id));
  const groups = groupOrder.map(group => section(group, pool.filter(item => item.group === group && !seen.has(item.id)).slice(0, group === 'Command' ? perGroup * 2 : 4).map(plain)));
  return [...(recent.length ? [{ title: 'Recent', items: recent }] : []), ...groups].filter(entry => entry.items.length > 0);
}

/** Ranked search: groups appear in the order of their best match; within a group, rank, then recency, then source order. */
function search(pool: Candidate[], text: string, recents: readonly string[]): PaletteSection[] {
  const recency = (id: string): number => { const at = recents.indexOf(id); return at < 0 ? recents.length : at; };
  const ranked = pool.flatMap((item, order) => {
    const match = matchQuery(text, item.label, item.detail);
    return match ? [{ item: { ...item, segments: segments(item.label, match.ranges) }, rank: match.rank, recent: recency(item.id), order }] : [];
  }).sort((a, b) => a.rank - b.rank || a.recent - b.recent || a.order - b.order);
  const groups = [...new Set(ranked.map(entry => entry.item.group))];
  return groups.map(group => section(group, ranked.filter(entry => entry.item.group === group).slice(0, perGroup).map(entry => entry.item)));
}

const capped = (sections: PaletteSection[]): PaletteSection[] => {
  let room = limit;
  return sections.map(entry => { const items = entry.items.slice(0, room); room -= items.length; return { ...entry, items }; }).filter(entry => entry.items.length > 0);
};

/**
 * The jump-anywhere palette: typed groups (`>` commands, `@` sessions and lanes, `#` questions and requests, `/` messages),
 * ranking by prefix and word start before loose subsequence matches, match highlights and recents. Read-only targets.
 */
export function paletteView(input: PaletteInput): PaletteView {
  const { text, scope } = parseQuery(input.query);
  const wanted: readonly PaletteGroup[] = scope ? scope.groups : groupOrder;
  const pool = candidates(input).filter(item => wanted.includes(item.group));
  const recents = input.recents ?? [];
  const sections = capped(text ? search(pool, text, recents) : browse(pool, recents));
  const items = sections.flatMap(entry => entry.items);
  return { scope: scope ? scope.label : 'everything', sections, items, shown: items.length, total: pool.length };
}

export const paletteItems = (input: PaletteInput): PaletteItem[] => paletteView(input).items;

/** Remembers a pick: newest first, no duplicates, at most eight. */
export const rememberPick = (recents: readonly string[], id: string): string[] => [id, ...recents.filter(entry => entry !== id)].slice(0, 8);
