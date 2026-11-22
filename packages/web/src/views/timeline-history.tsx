import type { ConsoleState } from '../state/state.ts';
import { LoadOlder } from './load-older.tsx';

const collections = ['sessions', 'requests', 'questions', 'messages', 'resets'] as const;

export function TimelineHistory({ state }: { state: ConsoleState }) {
  const bounded = collections.filter(collection => state.bounded.includes(collection));
  if (bounded.length === 0) return null;
  const pending = bounded.filter(collection => state.history[collection]?.more !== false);
  return (
    <section className="timeline-history" aria-label="Timeline history">
      <p className="muted small">Loaded history counts, independent of zoom.</p>
      {pending.length > 0 && <p className="muted small">Limited history: older {pending.join(', ')} may be missing.</p>}
      <div className="timeline-history-rows">
        {bounded.map(collection => <div key={collection} role="group" aria-label={`${collection} history`}>
          <LoadOlder state={state} collection={collection} shown={state[collection].length} noun={collection} buttonLabel={`Load older ${collection}`} />
        </div>)}
      </div>
    </section>
  );
}
