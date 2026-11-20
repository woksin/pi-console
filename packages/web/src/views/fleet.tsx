import { buildFleet, fleetFilters, type FleetGrouping, type FleetRow } from '@pi-console/viewmodels';
import { useMemo, useRef, useState } from 'react';
import { copyText, navigate, useConsole, useSelection } from '../app/hooks.ts';
import { useCommands } from '../app/commands.ts';
import { sessionHref } from '../app/routes.ts';
import { EmptyState, PressureBar, SearchBox, Sparkline, StatusBadge } from '../ui/primitives.tsx';
import { useChangeFlash, useScrollIntoView } from '../ui/hooks.ts';
import { useViewFocus } from '../app/focus.ts';

function Row({ row, selected, onSelect }: { row: FleetRow; selected: boolean; onSelect: () => void }) {
  const flash = useChangeFlash(row.badge.status);
  const ref = useScrollIntoView<HTMLTableRowElement>(selected);
  return (
    <tr ref={ref} className={`row${selected ? ' selected' : ''}${flash ? ' flash' : ''}${row.attention ? ' attention' : ''}`} aria-selected={selected}
      onClick={onSelect} onDoubleClick={() => { navigate(sessionHref(row.id)); }}>
      <td className="col-status"><StatusBadge badge={row.badge} /></td>
      <td className={`col-name depth-${String(row.depth)}`}><a href={sessionHref(row.id)}>{row.name}</a>{row.subagents > 0 && <span className="pill">{row.subagents} sub</span>}</td>
      <td className="mono">{row.laneId}</td>
      <td className="mono muted truncate">{row.branch}</td>
      <td className="muted">{row.model}</td>
      <td className="col-context"><PressureBar pressure={row.pressure} /></td>
      <td><Sparkline values={row.trend} width={84} height={20} label="Context trend" /></td>
      <td className="num">{row.openRequests > 0 ? <span className="pill amber">{row.openRequests}</span> : <span className="muted">–</span>}</td>
      <td className="num muted tnum">{row.active}</td>
    </tr>
  );
}

export function FleetView() {
  const state = useConsole();
  const [filter, setFilter] = useState('');
  const [grouping, setGrouping] = useState<FleetGrouping>('repository');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const search = useRef<HTMLInputElement | null>(null);
  const model = useMemo(() => buildFleet(state, { filter, grouping, collapsed }), [state, filter, grouping, collapsed]);
  const [selected, setSelected, move, jump] = useSelection(model.order);
  const savedIndex = fleetFilters.indexOf(filter as typeof fleetFilters[number]);
  const step = (delta: number): void => { setFilter(fleetFilters[(Math.max(0, savedIndex) + delta + fleetFilters.length) % fleetFilters.length]); };
  useViewFocus(search);
  useCommands(command => {
    switch (command.type) {
      case 'move': move(command.delta); return true;
      case 'top': case 'bottom': jump(command.type); return true;
      case 'open': if (selected) navigate(sessionHref(selected)); return selected !== null;
      case 'copyId': if (selected) void copyText(selected); return selected !== null;
      case 'prevFilter': step(-1); return true;
      case 'nextFilter': step(1); return true;
      case 'toggle': {
        const group = model.groups.find(item => item.rows.some(row => row.id === selected));
        if (group) setCollapsed(list => list.includes(group.id) ? list.filter(id => id !== group.id) : [...list, group.id]);
        return group !== undefined;
      }
      default: return false;
    }
  });
  if (model.empty) return <div className="page"><EmptyState title="No pi sessions found yet." mark="◇">Sources checked: the pi session directory and the lane registry. Backfill progress shows here once the daemon has read them.</EmptyState></div>;
  return (
    <div className="page">
      <header className="toolbar">
        <SearchBox value={filter} onChange={setFilter} placeholder="Filter sessions (status:working repo name…)" inputRef={search} />
        <div className="seg" role="group" aria-label="Saved filters">
          {fleetFilters.map(saved => <button key={saved} type="button" aria-pressed={saved === filter} onClick={() => { setFilter(saved); }}>{saved === '' ? 'All' : saved.replace('status:', '')}</button>)}
        </div>
        <div className="seg" role="group" aria-label="Group by">
          {(['repository', 'status'] as const).map(option => <button key={option} type="button" aria-pressed={grouping === option} onClick={() => { setGrouping(option); }}>{option}</button>)}
        </div>
        <span className="muted tnum grow end">{model.summary}</span>
      </header>
      <table className="grid fleet">
        <thead><tr><th>Status</th><th>Session</th><th>Lane</th><th>Branch</th><th>Model</th><th>Context</th><th>Trend</th><th className="num">Open</th><th className="num">Active</th></tr></thead>
        {model.groups.map(group => (
          <tbody key={group.id}>
            <tr className="group-row"><th colSpan={9}>
              <button type="button" className="group-toggle" aria-expanded={!group.collapsed} onClick={() => { setCollapsed(list => list.includes(group.id) ? list.filter(id => id !== group.id) : [...list, group.id]); }}>
                <span aria-hidden="true">{group.collapsed ? '▸' : '▾'}</span> {group.name} <span className="muted">{group.count}</span>
              </button>
            </th></tr>
            {!group.collapsed && group.rows.map(row => <Row key={row.id} row={row} selected={row.id === selected} onSelect={() => { setSelected(row.id); }} />)}
          </tbody>
        ))}
      </table>
      {model.shown === 0 && <EmptyState title="No sessions match this filter." mark="⌕">Press Esc in the filter box to clear it.</EmptyState>}
    </div>
  );
}
