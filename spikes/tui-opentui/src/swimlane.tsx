import { useMemo, useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { clip, type State } from './model.ts';
import { column, markers, pan, zoom, type Marker } from './signature-model.ts';
import { status, type Theme } from './theme.ts';
import { useMotion } from './motion.ts';

export function Swimlane({ state, t, width, height, selected, onSelect, onOpen, modal }: { state: State; t: Theme; width: number; height: number; selected: string; onSelect: (id: string) => void; onOpen: (id: string, at: number) => void; modal: boolean }) {
  const epoch = Math.min(...state.sessions.map(s => Date.parse(s.startedAt)));
  const [window, setWindow] = useState({ start: epoch - 5000, span: 150000 });
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [markerId, setMarkerId] = useState('r1');
  const arrival = useMotion('swimlane');
  const all = useMemo(() => markers(state), [state.revision]);
  const sessions = state.sessions.filter(s => !collapsed.has(s.repositoryId));
  const laneMarkers = all.filter(m => m.sessionId === selected);
  const marker = laneMarkers.find(m => m.id === markerId) ?? laneMarkers[0];
  const labelWidth = width < 100 ? 22 : 29;
  const plotWidth = width - labelWidth - 4;
  const capacity = Math.max(2, Math.floor((height - 10) / 2));
  const index = sessions.findIndex(s => s.id === selected);
  const offset = Math.max(0, Math.min(sessions.length - capacity, index - Math.floor(capacity / 2)));
  const visible = sessions.slice(offset, offset + capacity);
  const repositories = [...new Set(state.sessions.map(s => s.repositoryId))];
  const collapse = (repository: string) => setCollapsed(old => {
    const next = new Set(old);
    if (next.has(repository)) next.delete(repository); else next.add(repository);
    return next;
  });
  const choose = (item: Marker) => { onSelect(item.sessionId); setMarkerId(item.id); };
  useKeyboard(key => {
    if (modal) return;
    if (['+', '='].includes(key.sequence)) setWindow(w => zoom(w, .65));
    if (key.sequence === '-') setWindow(w => zoom(w, 1 / .65));
    if (key.name === 'h' || key.name === 'l') setWindow(w => pan(w, key.name === 'h' ? -1 : 1));
    if (['j', 'k', 'down', 'up'].includes(key.name)) {
      const delta = ['j', 'down'].includes(key.name) ? 1 : -1;
      onSelect(sessions[Math.max(0, Math.min(sessions.length - 1, index + delta))]?.id ?? selected);
    }
    if (key.sequence === '[' || key.sequence === ']') {
      const i = Math.max(0, laneMarkers.findIndex(m => m.id === marker?.id));
      const next = laneMarkers[(i + (key.sequence === ']' ? 1 : -1) + laneMarkers.length) % laneMarkers.length];
      if (next) { choose(next); if (column(next.at, window, plotWidth) < 0 || column(next.at, window, plotWidth) >= plotWidth) setWindow(w => ({ ...w, start: next.at - w.span / 2 })); }
    }
    if (key.name === 'c') collapse(state.sessions.find(s => s.id === selected)?.repositoryId ?? repositories[0]);
    if (key.name === 'return') onOpen(selected, marker?.at ?? window.start);
    if (key.name === 'n') setWindow(w => ({ ...w, start: state.liveAt - w.span * .8 }));
  });
  const nowColumn = column(state.liveAt, window, plotWidth);
  return <box height={height} flexDirection="column" border borderStyle="rounded" borderColor={t.border} backgroundColor={t.panel} paddingX={1}>
    <box height={2} flexDirection="row" paddingTop={Math.max(0, Math.round((1 - arrival) * 2))}>
      <text fg={t.cyan}><strong>TIME / SIGNAL</strong><span fg={t.muted}>  {Math.round(window.span / 1000)}s window</span></text><box flexGrow={1} /><text fg={t.faint}>+ − zoom · h/l pan · n now</text>
    </box>
    <box height={1} flexDirection="row" gap={2}>
      {repositories.map(repo => <text key={repo} fg={collapsed.has(repo) ? t.faint : t.blue} onMouseDown={() => collapse(repo)}>{collapsed.has(repo) ? '▸' : '▾'} {repo}</text>)}
    </box>
    <box height={2} flexDirection="row" marginTop={1}>
      <text width={labelWidth} fg={t.faint}>SESSION / REPOSITORY</text>
      <box width={plotWidth} height={2}>
        <text position="absolute" top={1} fg={t.border}>{'┬' + '─'.repeat(Math.max(0, plotWidth - 2)) + '┬'}</text>
        {[0, .25, .5, .75].map(f => <text key={f} position="absolute" left={Math.floor(f * plotWidth)} fg={t.muted}>{new Date(window.start + f * window.span).toISOString().slice(11, 19)}</text>)}
        {nowColumn >= 0 && nowColumn < plotWidth - 4 && <text position="absolute" top={1} left={nowColumn} fg={t.cyan}>▼ NOW</text>}
      </box>
    </box>
    <box flexGrow={1} flexDirection="column" overflow="hidden" onMouseScroll={event => setWindow(w => pan(w, event.scroll?.direction === 'up' ? -1 : 1))}>
      {visible.map(s => {
        const active = s.id === selected;
        const items = all.filter(m => m.sessionId === s.id && m.at >= window.start && m.at <= window.start + window.span);
        return <box key={s.id} height={2} flexShrink={0} backgroundColor={active ? t.select : t.panel} flexDirection="row" onMouseDown={() => onSelect(s.id)}>
          <box width={labelWidth} flexDirection="column">
            <text fg={active ? t.text : t.muted}>{active ? '▸' : ' '} <span fg={status(t, s.status)[1]}>{status(t, s.status)[0]}</span> {clip(`${s.laneId} ${s.name.replace(s.repositoryId + ' ', '')}`, labelWidth - 5)}</text>
            <text fg={t.faint}>    {s.repositoryId}<span fg={t.border}> / {s.id}</span></text>
          </box>
          <box width={plotWidth} height={2}>
            <text fg={active ? t.blue : t.border}>{'─'.repeat(plotWidth)}</text>
            {[0, .25, .5, .75].map(f => <text key={f} position="absolute" left={Math.floor(f * (plotWidth - 1))} top={1} fg={t.border}>┊</text>)}
            {nowColumn >= 0 && nowColumn < plotWidth && <text position="absolute" left={nowColumn} top={0} fg={t.cyan}>{'│\n┊'}</text>}
            {items.map(m => <box key={m.id} position="absolute" left={column(m.at, window, plotWidth)} top={0} width={1} height={2} onMouseDown={event => { event.stopPropagation(); choose(m); }}>
              <text fg={t[m.color]} bg={marker?.id === m.id ? t.select : undefined}>{m.glyph === '┃' ? '┃\n┃' : m.glyph}</text>
            </box>)}
          </box>
        </box>;
      })}
      {!visible.length && <text fg={t.muted}>Repositories collapsed. Click a repository above to expand.</text>}
    </box>
    <box height={5} flexShrink={0} border borderStyle="single" borderColor={marker ? t[marker.color] : t.border} paddingX={1} flexDirection="column" title=" SELECTED SIGNAL / [ ] CYCLE ">
      <text fg={marker ? t[marker.color] : t.faint}>{marker ? `${marker.glyph} ${marker.kind.toUpperCase()} · ${marker.sessionId} · ${new Date(marker.at).toISOString().slice(11, 19)}` : 'No recorded signal in this lane.'}</text>
      <text fg={t.text}>{clip(marker?.text ?? 'Select another lane or marker.', width - 9)}</text>
      <text fg={t.faint}>↵ open transcript at signal · click marker · c collapse repository · wheel pan</text>
    </box>
    <text height={1} fg={t.faint}><span fg={t.blue}>◆</span> request  <span fg={t.green}>●</span> answer  <span fg={t.pink}>╳</span> interrupted  <span fg={t.pink}>┃</span> reset  <span fg={t.amber}>?</span> question  <span fg={t.cyan}>›</span><span fg={t.violet}>‹</span> messages · {offset + 1}–{offset + visible.length}/{sessions.length}</text>
  </box>;
}
