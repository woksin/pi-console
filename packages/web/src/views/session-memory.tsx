import { memoryPanelViewModel, type MemoryPanelItem } from '@pi-console/viewmodels';
import { useEffect } from 'react';
import { clockNow, copyText, useConsole, useStore } from '../app/hooks.ts';
import { Panel } from '../ui/primitives.tsx';

function MemoryItemView({ item, request }: { item: MemoryPanelItem; request: (action: 'confirm' | 'reject') => void }) {
  return <li className="memory-item" data-memory-item={item.id}>
    <span className="small muted">{item.kind} · {item.statusLabel} · {item.scope} · {item.sourceNote}</span>
    <span title={item.text}>{item.text}</span>
    {(item.canRequest || item.review) && <span className="memory-actions">
      <button type="button" disabled={!item.canRequest} onClick={() => { request('confirm'); }}>Confirm…</button>{' '}
      <button type="button" disabled={!item.canRequest} onClick={() => { request('reject'); }}>Reject…</button>
    </span>}
    {item.review && <span role="status" className="small muted">{item.review.message}</span>}
    {item.command && <span className="mono small">Run in a pi session: <code>{item.command}</code> or <code>{item.rejectCommand}</code>{' '}
      <button type="button" className="memory-copy" onClick={() => { void copyText(item.command ?? ''); }}>Copy command</button></span>}
  </li>;
}

/** Memory stays producer-owned; these controls only request a native human review in pi. */
export function SessionMemory({ id }: { id: string }) {
  const store = useStore();
  const state = useConsole();
  const updatedAt = state.sessions.find(session => session.id === id)?.updatedAt ?? '';
  const now = clockNow(state, Date.now());
  useEffect(() => { void store.loadSessionMemory(id); }, [store, id, updatedAt, state.gapCount]);
  const memory = state.memory[id] ?? null;
  const view = memoryPanelViewModel({ memory, items: state.memoryItems[id] ?? [], now, review: state.memoryReviews.get(id) });
  if (!view.available) return <Panel title={view.title} aside="none seen"><span className="faint">No intent-memory store seen for this session</span></Panel>;
  return (
    <Panel title={view.title} aside={memory?.counts.proposed ? `${String(memory.counts.proposed)} proposed` : undefined} className="memory-panel">
      <p className="small muted">{view.counts.filter(cell => cell.count > 0).map(cell => `${String(cell.count)} ${cell.label}`).join(' · ') || 'no items'}</p>
      <p className="small muted">{view.unresolved.text}</p>
      <ul className="mini-list stacked">
        {view.items.map(item => <MemoryItemView key={item.id} item={item} request={action => { void store.requestMemoryAction(id, item.id, action); }} />)}
      </ul>
      {view.handoffs.length > 0 && <ul className="mini-list">{view.handoffs.map(handoff => <li key={handoff.id}><span className="truncate">{handoff.id}</span><span className="faint small">{handoff.age} ago · {handoff.text}</span></li>)}</ul>}
      <p className="faint small">{view.hint}</p>
    </Panel>
  );
}
