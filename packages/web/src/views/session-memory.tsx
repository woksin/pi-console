import { memoryPanelViewModel, memoryReviewPending, type MemoryPanelItem } from '@pi-console/viewmodels';
import { useEffect, useMemo, type ReactNode } from 'react';
import { copyWithNotice } from '../app/copy-notice.ts';
import { clockNow, useConsole, useStore } from '../app/hooks.ts';
import { Panel } from '../ui/primitives.tsx';
import type { MemoryReadStatus } from '../state/state.ts';

export function MemoryItemView({ item, request }: { item: MemoryPanelItem; request: (action: 'confirm' | 'reject') => void }) {
  const busy = item.review !== null && memoryReviewPending(item.review.state);
  return <li className="memory-item" data-memory-item={item.id}>
    <span className="memory-head">
      <span className={`badge memory-badge tone-${item.badge.tone}`} data-memory-status={item.status}>{item.badge.label}</span>
      <span className="memory-text" title={item.text}>{item.text}</span>
    </span>
    <span className="small faint memory-details">{item.details}</span>
    {(item.canRequest || item.review) && <span className="memory-actions">
      <button type="button" className="btn" disabled={!item.canRequest} aria-busy={busy} onClick={() => { request('confirm'); }}>Confirm…</button>
      <button type="button" className="btn" disabled={!item.canRequest} aria-busy={busy} onClick={() => { request('reject'); }}>Reject…</button>
    </span>}
    {item.review && <span role="status" className="small muted">{item.review.message}</span>}
    {item.command && <span className="mono small">Run in a pi session: <code>{item.command}</code> or <code>{item.rejectCommand}</code>
      <span className="memory-actions"><button type="button" className="btn memory-copy" onClick={() => { void copyWithNotice(item.command ?? '', 'memory command'); }}>Copy command</button></span></span>}
  </li>;
}

function MemoryNotice({ status, stale, retry }: { status: MemoryReadStatus | undefined; stale: boolean; retry: () => void }) {
  if (status?.status === 'loaded' || status?.status === 'absent') return null;
  const loading = status?.status !== 'error';
  return <div className="toolbar">
    <span role="status" aria-label="Memory read status" aria-busy={loading}>
      {loading ? 'Loading memory…' : `Could not load memory. ${status.message}`}
      {stale && ' Showing previously loaded memory.'}
    </span>
    <button type="button" className="btn" aria-disabled={loading} aria-busy={loading} onClick={loading ? undefined : retry}>Retry</button>
  </div>;
}

function UnavailableMemory({ title, status, notice }: { title: string; status: MemoryReadStatus | undefined; notice: ReactNode }) {
  const absent = status?.status === 'absent';
  return <Panel title={title} aside={absent ? 'none seen' : undefined}>
    {absent ? <span className="faint">No intent-memory store seen for this session</span> : notice}
  </Panel>;
}

/** Memory stays producer-owned; these controls only request a native human review in pi. */
export function SessionMemory({ id }: { id: string }) {
  const store = useStore();
  const state = useConsole();
  const now = clockNow(state, Date.now());
  useEffect(() => store.watchSessionMemory(id), [store, id]);
  const memory = state.memory[id] ?? null;
  const sessionNames = useMemo(() => new Map(state.sessions.map(session => [session.id, session.name])), [state.sessions]);
  const view = memoryPanelViewModel({ memory, items: state.memoryItems[id] ?? [], now, review: state.memoryReviews.get(id), sessionNames });
  const status = state.memoryStatus[id];
  const notice = <MemoryNotice status={status} stale={view.available} retry={() => { void store.loadSessionMemory(id); }} />;
  if (!view.available) return <UnavailableMemory title={view.title} status={status} notice={notice} />;
  return (
    <Panel title={view.title} aside={memory?.counts.proposed ? `${String(memory.counts.proposed)} proposed` : undefined} className="memory-panel">
      {notice}
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
