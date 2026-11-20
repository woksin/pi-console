import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { fleetSessions, Fleet } from './fleet.tsx';
import { attention, clip, fuzzy, Store } from './model.ts';
import { Detail } from './transcript.tsx';
import { theme, type Colors } from './theme.ts';

type Action = { label: string; hint: string; run: () => void };
export function App({ store, colors = 'truecolor', quit = () => {}, load = async () => {} }: { store: Store; colors?: Colors; quit?: () => void; load?: (id: string) => Promise<void> }) {
  useSyncExternalStore(store.subscribe, store.version);
  const state = store.state;
  const { width, height } = useTerminalDimensions();
  const [selected, setSelected] = useState('s2');
  const [detail, setDetail] = useState(false);
  const [needsOnly, setNeedsOnly] = useState(false);
  const [focus, setFocus] = useState(0);
  const [overlay, setOverlay] = useState<'palette' | 'help' | 'search' | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [choice, setChoice] = useState(0);
  const [contrast, setContrast] = useState(false);
  const [now, setNow] = useState(new Date());
  const [loadError, setLoadError] = useState('');
  const t = useMemo(() => theme(colors, contrast), [colors, contrast]);
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 500); return () => clearInterval(timer); }, []);
  const session = state.sessions.find(s => s.id === selected) ?? state.sessions[0];
  const items = fleetSessions(state, needsOnly, search);
  const move = (delta: number) => {
    const index = Math.max(0, items.findIndex(s => s.id === selected));
    setSelected(items[Math.max(0, Math.min(items.length - 1, index + delta))]?.id ?? selected);
  };
  const openSession = (id: string) => {
    setSelected(id); setDetail(true); setFocus(0); setOverlay(null); setSearch(''); setLoadError('');
    void load(id).catch(error => setLoadError(String(error)));
  };
  const actions: Action[] = [
    { label: 'Go to fleet overview', hint: 'Esc', run: () => setDetail(false) },
    { label: 'Filter needs-you sessions', hint: '!', run: () => { setDetail(false); setNeedsOnly(v => !v); } },
    { label: 'Toggle theme / high contrast', hint: 'theme', run: () => setContrast(v => !v) },
    ...state.sessions.map(s => ({ label: `Go to session ${s.laneId} / ${s.name} / ${s.id}`, hint: '↵', run: () => openSession(s.id) })),
    { label: 'Quit pi-console', hint: 'q', run: quit },
  ];
  const matches = actions.filter(action => fuzzy(query, action.label));
  const showOverlay = (type: typeof overlay) => { setOverlay(type); setQuery(''); setChoice(0); };
  useKeyboard(key => {
    if (key.ctrl && key.name === 'c') { quit(); return; }
    if (key.name === 'escape') {
      if (overlay) setOverlay(null);
      else if (search) setSearch('');
      else setDetail(false);
      return;
    }
    if (overlay === 'palette') {
      if (key.name === 'down') setChoice(v => Math.min(matches.length - 1, v + 1));
      if (key.name === 'up') setChoice(v => Math.max(0, v - 1));
      if (key.name === 'return') { matches[choice]?.run(); setOverlay(null); }
      return;
    }
    if (overlay === 'search') {
      if (key.name === 'return') { setSearch(query); setOverlay(null); }
      return;
    }
    if (overlay) return;
    if ((key.ctrl && key.name === 'p') || key.sequence === ':') { showOverlay('palette'); return; }
    if (key.sequence === '?') { showOverlay('help'); return; }
    if (key.sequence === '/') { showOverlay('search'); return; }
    if (key.name === 'tab') { setFocus(v => 1 - v); return; }
    if (key.name === 'q') quit();
    if (!detail) {
      if (key.name === 'down' || key.name === 'j') move(1);
      if (key.name === 'up' || key.name === 'k') move(-1);
      if (key.name === 'return' && session) openSession(session.id);
      if (key.sequence === '!') setNeedsOnly(v => !v);
      if (key.name === 'g') setSelected(items[key.shift ? items.length - 1 : 0]?.id ?? selected);
    }
  });
  const bodyHeight = Math.max(8, height - 7);
  const count = (value: string) => state.sessions.filter(s => s.status === value).length;
  const pills = [['WORK', count('working'), t.cyan], ['NEEDS YOU', state.sessions.filter(s => attention(state, s)).length, t.amber], ['BLOCKED', count('blocked'), t.orange], ['FAILED', count('failed'), t.red]] as const;
  return <box width={width} height={height} backgroundColor={t.bg} flexDirection="column" paddingX={1}>
    <box height={3} flexShrink={0} alignItems="center" flexDirection="row" gap={2}>
      <text height={1}><strong>{[...'pi-console'].map((char, i) => <span key={i} fg={[t.cyan, t.cyan, t.cyan, t.blue, t.blue, t.blue, t.violet, t.violet, t.pink, t.pink][i]}>{char}</span>)}</strong><span fg={t.faint}> / M0</span></text>
      {pills.slice(0, width < 95 ? 2 : 4).map(([name, value, color]) => <box key={name} backgroundColor={t.raised} height={1} paddingX={1}><text fg={color}><strong>{value} {name}</strong></text></box>)}
      <box flexGrow={1} />
      <text height={1} fg={state.connected ? t.green : t.red}>{state.connected ? '● live' : '○ offline'}<span fg={t.muted}>  {now.toLocaleTimeString('en-GB')}</span></text>
    </box>
    <box height={2} flexShrink={0} flexDirection="row">
      <text height={1} fg={t.cyan}><strong>{detail && session ? ` FLEET / ${session.repositoryId.toUpperCase()} / ${session.laneId}` : ' 01 OVERVIEW'}</strong><span fg={t.muted}>   {detail ? clip(session?.name ?? '', width - 65) : 'Fleet intelligence, without the noise.'}</span></text>
      <box flexGrow={1} />
      <text height={1} fg={t.faint}>{colors} · read-only mock </text>
    </box>
    {!state.sessions.length ? <box height={bodyHeight}><text fg={t.amber}>{state.error || 'Connecting to mock daemon…'}</text></box> : detail && session
      ? <Detail state={state} session={session} t={t} width={width - 2} height={bodyHeight} focus={focus} search={search} modal={overlay !== null} />
      : <Fleet state={state} selected={selected} needsOnly={needsOnly} t={t} width={width - 2} height={bodyHeight} focus={focus} search={search} onSelect={id => { setSelected(id); setFocus(0); }} onMove={move} />}
    <box height={2} flexShrink={0} flexDirection="column" paddingTop={1}>
      <text height={1} fg={t.muted}><span fg={t.cyan}> {detail ? 'esc' : 'j/k'}</span> {detail ? 'fleet' : 'move'}  <span fg={t.cyan}>↵</span> {detail ? 'expand' : 'open'}  <span fg={t.cyan}>tab</span> pane  <span fg={t.cyan}>{detail ? 'f' : '!'}</span> {detail ? 'follow' : 'needs-you'}  <span fg={t.cyan}>/</span> search  <span fg={t.cyan}>^P</span> palette  <span fg={t.cyan}>?</span> help  <span fg={t.cyan}>q</span> quit{loadError || state.error ? <span fg={t.red}>  {clip(loadError || state.error, 40)}</span> : null}</text>
    </box>
    {overlay && <box position="absolute" top={overlay === 'search' ? 5 : Math.max(3, Math.floor(height * .18))} left={Math.max(2, Math.floor(width * .19))} width={Math.min(90, Math.floor(width * .64))} border borderStyle="rounded" borderColor={t.cyan} backgroundColor={t.raised} padding={1} flexDirection="column" title={` ${overlay === 'palette' ? 'COMMAND PALETTE' : overlay === 'help' ? 'KEYBOARD / FIELD GUIDE' : detail ? 'TRANSCRIPT SEARCH' : 'FLEET SEARCH'} `}>
      {overlay === 'help' ? <>
        <text fg={t.text}>Navigate with intention.</text>
        <text fg={t.muted}>{'\nj / k, ↑ / ↓     move / pause transcript\nEnter           open / expand first visible tool\nClick           select row / expand tool\nWheel           scroll pane\nTab             switch focused pane\nf / G           follow live transcript\ng               oldest retained transcript\n/               search transcript text\n!               needs-you fleet filter\nCtrl+P / :      fuzzy command palette\nEsc             close / back\nq / Ctrl+C      quit (never aborts agents)\n'}</text>
        <text fg={t.amber}>Synthetic data · read-only · Esc to close</text>
      </> : <>
        <input focused placeholder={overlay === 'search' ? detail ? 'Search transcript… Enter to apply' : 'Filter sessions… Enter to apply' : 'Type a command or session…'} value={query} onInput={value => { setQuery(value); setChoice(0); }} backgroundColor={t.bg} textColor={t.text} cursorColor={t.cyan} />
        {overlay === 'palette' && <box marginTop={1} flexDirection="column">
          {matches.slice(Math.max(0, choice - 7), Math.max(8, choice + 1)).map((action, i) => {
            const index = Math.max(0, choice - 7) + i;
            return <box key={action.label} height={2} paddingTop={1} backgroundColor={index === choice ? t.select : t.raised} onMouseDown={() => { action.run(); setOverlay(null); }}><text fg={index === choice ? t.cyan : t.text}>{index === choice ? '▸ ' : '  '}{clip(action.label, Math.min(80, Math.floor(width * .64)) - 8)}</text></box>;
          })}
          {!matches.length && <text fg={t.muted}>No matching commands.</text>}
          <text fg={t.faint}>↑↓ select · ↵ run · Esc dismiss</text>
        </box>}
      </>}
    </box>}
  </box>;
}
