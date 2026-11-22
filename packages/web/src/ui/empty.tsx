import type { ReactNode } from 'react';
import { emptyStates, firstRunChecklist, type EmptyStateModel, type EmptyView } from '@pi-console/viewmodels';
import { EmptyState } from './primitives.tsx';

/** A view's empty state from the shared wording (information architecture §8). */
export function EmptyFor(props: ({ view: EmptyView } | { model: EmptyStateModel }) & { children?: ReactNode }) {
  const model = 'model' in props ? props.model : emptyStates[props.view];
  const { children } = props;
  return <EmptyState title={model.title} mark={model.mark}>{model.body}{children}</EmptyState>;
}

/** First run: daemon running, sources detected, extension installed (optional); the same steps as the TUI. */
export function FirstRun({ connected, sessions }: { connected: boolean; sessions: number }) {
  const checklist = firstRunChecklist({ connected, sessions });
  return (
    <section className="first-run" aria-labelledby="first-run-title">
      <h3 id="first-run-title">{checklist.title}</h3>
      <ol>
        {checklist.steps.map(item => (
          <li key={item.label} className={`step-${item.state} tone-${item.color}`}>
            <span className="first-run-glyph" aria-hidden="true">{item.glyph}</span>
            <span><strong>{item.label}</strong><span className="sr-only"> ({item.state === 'todo' ? 'not yet' : item.state})</span><br /><span className="muted">{item.detail}</span></span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** An empty list: the view's own empty state when nothing exists, otherwise a note that the `/` filter hides everything. */
export function EmptyList({ view, none, noun }: { view: EmptyView; none: boolean; noun: string }) {
  if (none) return <EmptyFor view={view} />;
  return <EmptyState title={`No ${noun} match`}>Clear the filter to see every one.</EmptyState>;
}
