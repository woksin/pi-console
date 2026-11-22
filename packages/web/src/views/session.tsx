import { sessionViewModel } from '@pi-console/viewmodels';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionDetail } from '@pi-console/contract';
import type { ViewProps } from '../app/view.tsx';
import { useActions } from '../app/commands.ts';
import { copyWithNotice } from '../app/copy-notice.ts';
import { useStore, useSearchFocus } from '../app/hooks.ts';
import { EmptyState, SearchBox } from '../ui/primitives.tsx';
import type { SessionDetailStatus } from '../client/store.ts';
import { SessionHeader, SessionRail } from './session-rail.tsx';
import { Transcript } from './transcript.tsx';
import { useSessionTranscript } from './session-transcript.ts';

function detailOf(state: ViewProps['state'], id: string): SessionDetail | null {
  const session = state.sessions.find(item => item.id === id);
  if (!session) return null;
  return {
    session, requests: state.requests.filter(item => item.sessionId === id), questions: state.questions.filter(item => item.sessionId === id),
    jobs: state.jobs.filter(item => item.sessionId === id), resets: state.resets.filter(item => item.sessionId === id),
    subagents: state.sessions.filter(item => item.parentSessionId === id),
  };
}

function DetailNotice({ status, retry }: { status: SessionDetailStatus | undefined; retry: () => void }) {
  if (status === 'not-found') return <EmptyState title="Session not found" mark="∅">It may not have been seen yet, or this link points at another daemon. <a href="#/fleet">Back to the fleet</a></EmptyState>;
  const loading = status !== 'failed';
  return <div className="toolbar">
    <span className={loading ? 'muted' : undefined} role="status" aria-label={loading ? 'Loading session' : undefined} aria-busy={loading}>
      {loading ? 'Loading session…' : 'Could not load session.'}
    </span>
    <button type="button" className="btn" aria-disabled={loading} aria-busy={loading} onClick={loading ? undefined : retry}>Retry</button>
  </div>;
}

export function SessionView({ state, now, id, entry }: ViewProps & { id: string; entry: string | null }) {
  const store = useStore();
  const [search, setSearch] = useState('');
  const box = useRef<HTMLInputElement>(null);
  useSearchFocus(box);
  useActions(action => { if (action !== 'copy.id') return false; void copyWithNotice(id, 'session id'); return true; });
  useSessionTranscript(store, id, entry, state);
  useEffect(() => { void store.loadSessionDetail(id); }, [store, id, state.gapCount]);
  const detail = useMemo(() => detailOf(state, id), [state, id]);
  const transcript = state.transcripts[id];
  const view = useMemo(() => detail ? sessionViewModel({ detail, transcript: transcript ?? [], now, search }) : null, [detail, transcript, now, search]);
  const status = store.getSessionDetailStatus(id);
  const notice = <DetailNotice status={status} retry={() => { void store.loadSessionDetail(id); }} />;
  if (!view) return <div className="page">{notice}</div>;
  return (
    <div className="page session">
      {(status === 'loading' || status === 'failed') && notice}
      <SessionHeader view={view} />
      <div className="session-body">
        <section className="transcript-pane" aria-label="Transcript">
          <div className="toolbar"><SearchBox value={search} onChange={setSearch} placeholder="Search this transcript…" inputRef={box} /><span className="muted small">{view.transcript.length} lines</span></div>
          <Transcript key={`${id}:${entry ?? ''}:${String(state.transcriptHistory[id]?.revision)}`} lines={view.transcript} focusEntry={state.transcriptHistory[id]?.focusEntry ?? null} searching={search !== ''} progress={state.transcriptHistory[id]} onPage={direction => { void store.pageTranscript(id, direction); }} onLive={() => { setSearch(''); void store.returnToLiveTranscript(id); }} onResume={() => { void store.transcriptReader.resume({ sessionId: id }); }} onFollow={following => { store.transcriptReader.following({ sessionId: id, following }); }} />
        </section>
        <SessionRail view={view} />
      </div>
    </div>
  );
}
