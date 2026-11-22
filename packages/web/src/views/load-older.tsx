import type { WindowedCollection } from '@pi-console/viewmodels';
import { useStore } from '../app/hooks.ts';
import type { ConsoleState } from '../state/state.ts';

/** "Showing N of total" with a button for the next page of history; renders nothing when the list is complete. */
export function LoadOlder({ state, collection, shown, noun, buttonLabel }: { state: ConsoleState; collection: WindowedCollection; shown: number; noun: string; buttonLabel?: string }) {
  const store = useStore();
  const total = state.totals?.[collection];
  if (!state.bounded.includes(collection) || total === undefined) return null;
  const complete = state.history[collection]?.more === false;
  const status = state.pageStatus[collection];
  return (
    <div className="toolbar load-older">
      <span className="muted small">Showing {shown} of {total} {noun}</span>
      {status === 'failed' && <span className="warn-text small" role="alert">Could not load older {noun}.</span>}
      {!complete && <OlderButton status={status} label={buttonLabel} onClick={() => { void store.loadMore(collection); }} />}
    </div>
  );
}

function OlderButton({ status, label, onClick }: { status: ConsoleState['pageStatus'][WindowedCollection]; label: string | undefined; onClick: () => void }) {
  const failed = status === 'failed';
  const text = status === 'loading' ? 'Loading…' : failed ? 'Retry' : 'Load older';
  return <button type="button" aria-label={label} disabled={status === 'loading'} aria-busy={status === 'loading'} onClick={onClick}>{text}</button>;
}
