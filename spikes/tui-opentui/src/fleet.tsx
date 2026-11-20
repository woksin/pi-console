import { activity, attention, clip, totals, type Session, type State } from './model.ts';
import { spark, status, type Theme } from './theme.ts';
import { Burn, Context, Label, Panel, Requests } from './widgets.tsx';

export function fleetSessions(state: State, needsOnly: boolean, search = '') {
  const items = state.sessions.filter(s => (!needsOnly || attention(state, s)) && `${s.name} ${s.laneId} ${s.repositoryId}`.toLowerCase().includes(search.toLowerCase()));
  return items.toSorted((a, b) => a.repositoryId.localeCompare(b.repositoryId) || familyOrder(a) - familyOrder(b));
}
function familyOrder(session: Session) {
  return { orchestrator: 0, main: session.parentSessionId ? 4 : session.name.endsWith('review') ? 4 : 1, subagent: 2 }[session.role] ?? 5;
}
function SessionRow({ session, state, selected, width, t, onSelect }: { session: Session; state: State; selected: boolean; width: number; t: Theme; onSelect: () => void }) {
  const [glyph, color] = status(t, session.status);
  const total = totals([session]);
  const flash = Date.now() - (state.changed.get(session.id) ?? 0) < 1100;
  const wide = width >= 100;
  const activityWidth = Math.max(7, width - (wide ? 83 : 56));
  const age = Math.max(0, Math.round((Date.parse(session.updatedAt) - Date.parse(session.startedAt)) / 60000));
  const name = `${session.parentSessionId ? '└ ' : ''}${session.laneId} ${session.name.replace(session.repositoryId + ' ', '')}`;
  return <box height={1} flexShrink={0} backgroundColor={selected ? t.select : flash ? t.flash : t.panel} onMouseDown={onSelect}>
    <text height={1} fg={t.text}>
      <span fg={selected ? t.cyan : t.faint}>{selected ? '▸' : ' '} </span>
      <span fg={color}>{glyph} </span>
      <span fg={selected ? t.text : t.muted}>{clip(name, wide ? 26 : 23).padEnd(wide ? 27 : 24)}</span>
      {wide && <span fg={t.faint}>{(session.role === 'orchestrator' ? 'orch' : session.role).padEnd(10)}</span>}
      <span fg={t.muted}>{clip(activity(state, session), activityWidth).padEnd(activityWidth + 1)}</span>
      <span fg={session.contextPercent > 75 ? t.amber : t.cyan}>{spark(session.samples.slice(-5).map(s => s.contextPercent))} {String(session.contextPercent).padStart(2)}% </span>
      {wide && <span fg={t.faint}>{(total.tokens / 1000).toFixed(0)}k </span>}
      <span fg={t.text}>${total.cost.toFixed(1)} </span>
      <span fg={t.faint}>{age}m</span>
    </text>
  </box>;
}
export function Fleet({ state, selected, needsOnly, t, width, height, focus, search = '', onSelect, onMove }: { search?: string; state: State; selected: string; needsOnly: boolean; t: Theme; width: number; height: number; focus: number; onSelect: (id: string) => void; onMove: (n: number) => void }) {
  const narrow = width < 100;
  const left = narrow ? width : Math.floor(width * .65);
  const right = narrow ? width : width - left - 1;
  const session = state.sessions.find(s => s.id === selected) ?? state.sessions[0];
  const items = fleetSessions(state, needsOnly, search);
  const attentionItems = state.sessions.filter(s => attention(state, s));
  const rows: ({ group: string } | Session)[] = [];
  for (const item of items) {
    if (!rows.length || items[items.indexOf(item) - 1]?.repositoryId !== item.repositoryId) rows.push({ group: item.repositoryId });
    rows.push(item);
  }
  const tableHeight = Math.max(3, (narrow ? Math.floor(height * .6) : height) - 11);
  const index = rows.findIndex(row => 'id' in row && row.id === selected);
  const offset = Math.max(0, Math.min(rows.length - tableHeight, index - Math.floor(tableHeight / 2)));
  const visible = rows.slice(offset, offset + tableHeight);
  return <box flexDirection={narrow ? 'column' : 'row'} gap={1} height={height} flexShrink={0}>
    <box width={left} flexDirection="column" height={narrow ? Math.floor(height * .6) : height}>
      <Panel title={`01 / NEEDS YOU · ${attentionItems.length}`} t={t} height={6}>
        <text height={1} fg={t.amber}><strong>Decisions before distractions.</strong><span fg={t.faint}>  {state.questions.filter(q => q.blocking).length} blocking questions</span></text>
        {attentionItems.slice(0, 2).map(s => <box key={s.id} height={1} onMouseDown={() => onSelect(s.id)}>
          <text fg={t.amber}>! <span fg={t.text}>{clip(`${s.repositoryId} / ${s.laneId}`, 22).padEnd(23)}</span><span fg={t.muted}>{clip(state.questions.find(q => q.sessionId === s.id)?.text ?? state.requests.find(r => r.sessionId === s.id)?.text ?? s.status, left - 31)}</span></text>
        </box>)}
      </Panel>
      <box flexGrow={1} marginTop={1} border borderStyle="rounded" borderColor={focus === 0 ? t.cyan : t.border} title={` 02 / SESSIONS · ${items.length}${search ? ` · “${search}”` : ''}${needsOnly ? ' · NEEDS YOU' : ' · BY REPOSITORY'} `} titleColor={t.cyan} backgroundColor={t.panel} flexDirection="column" overflow="hidden" onMouseScroll={event => onMove(event.scroll?.direction === 'up' ? -3 : 3)}>
        <text height={1} fg={t.faint}>  LANE / SESSION{' '.repeat(Math.max(1, left - 48))}CONTEXT  COST  AGE</text>
        {visible.map(row => 'group' in row
          ? <text key={row.group} height={1} fg={t.blue}> ── <strong>{row.group}</strong> <span fg={t.faint}>/ {state.sessions.filter(s => s.repositoryId === row.group).length} sessions ──</span></text>
          : <SessionRow key={row.id} state={state} session={row} selected={row.id === selected} width={left - 2} t={t} onSelect={() => onSelect(row.id)} />)}
        <box flexGrow={1} />
        <text height={1} fg={t.faint}> {offset + 1}–{Math.min(offset + tableHeight, rows.length)} / {rows.length} rows   <span fg={t.cyan}>▸ {session?.id ?? '—'}</span> · wheel or j/k</text>
      </box>
    </box>
    <box width={right} flexDirection="column" height={narrow ? height - Math.floor(height * .6) - 1 : height}>
      <Panel title="03 / SESSION PREVIEW" t={t} active={focus === 1} grow={1}>
        {session && <scrollbox flexGrow={1} focused={focus === 1}>
          <Label color={t.text}>{session.laneId} / {session.name}</Label>
          <text height={1} fg={status(t, session.status)[1]}>{status(t, session.status)[0]} {session.status} · {session.branch}</text>
          <Context session={session} t={t} />
          <box height={1} />
          <Requests state={state} session={session} t={t} width={right} compact />
        </scrollbox>}
      </Panel>
      {!narrow && <box marginTop={1} flexShrink={0}><Burn state={state} t={t} width={right} height={Math.max(9, Math.floor(height * .36))} /></box>}
    </box>
  </box>;
}
