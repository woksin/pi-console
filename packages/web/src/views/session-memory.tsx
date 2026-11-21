import { memoryPanelViewModel } from '@pi-console/viewmodels';
import { useEffect } from 'react';
import { clockNow, copyText, useConsole, useStore } from '../app/hooks.ts';
import { Panel } from '../ui/primitives.tsx';

/**
 * Read-only intent-memory panel for one session. It shows the exact `/memory confirm <id>` text a human runs in a pi
 * session; the buttons only copy that text. Nothing here sends a request other than GET.
 */
export function SessionMemory({ id }: { id: string }) {
  const store = useStore();
  const state = useConsole();
  const updatedAt = state.sessions.find(session => session.id === id)?.updatedAt ?? '';
  const now = clockNow(state, Date.now());
  useEffect(() => { void store.loadSessionMemory(id); }, [store, id, updatedAt, state.gapCount]);
  const memory = state.memory[id] ?? null;
  const view = memoryPanelViewModel({ memory, items: state.memoryItems[id] ?? [], now });
  if (!view.available) return <Panel title={view.title} aside="none seen"><span className="faint">No intent-memory store seen for this session</span></Panel>;
  return (
    <Panel title={view.title} aside={memory?.counts.proposed ? `${String(memory.counts.proposed)} proposed` : undefined} className="memory-panel">
      <p className="small muted">{view.counts.filter(cell => cell.count > 0).map(cell => `${String(cell.count)} ${cell.label}`).join(' · ') || 'no items'}</p>
      <p className="small muted">{view.unresolved.text}</p>
      <ul className="mini-list stacked">
        {view.items.map(item => (
          <li key={item.id} className="memory-item">
            <span className="small muted">{item.kind} · {item.statusLabel} · {item.scope} · {item.sourceNote}</span>
            <span title={item.text}>{item.text}</span>
            {item.command && <span className="mono small">Run in a pi session: <code>{item.command}</code> or <code>{item.rejectCommand}</code>{' '}
              <button type="button" className="memory-copy" onClick={() => { void copyText(item.command ?? ''); }}>Copy command</button></span>}
          </li>
        ))}
      </ul>
      {view.handoffs.length > 0 && <ul className="mini-list">{view.handoffs.map(handoff => <li key={handoff.id}><span className="truncate">{handoff.id}</span><span className="faint small">{handoff.age} ago · {handoff.text}</span></li>)}</ul>}
      <p className="faint small">{view.hint}</p>
    </Panel>
  );
}
