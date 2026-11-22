import type { RequestsRow } from '@pi-console/viewmodels';
import { sessionHref } from '../../app/routes.ts';
import { StatusBadge } from '../../ui/primitives.tsx';
import { useScrollIntoView } from '../../ui/hooks.ts';

/** One request in the list. Stored text is shown as text; the origin chip says "classified as", the uncertain and unseen labels are always visible. */
export function RequestCard({ row, selected, onSelect }: { row: RequestsRow; selected: boolean; onSelect: () => void }) {
  const ref = useScrollIntoView<HTMLLIElement>(selected);
  return (
    <li ref={ref} className={`card request-card tone-${row.status.color}${row.origin === 'human' ? ' human-request' : ''}${selected ? ' selected' : ''}`} onClick={onSelect} data-request={row.id} aria-current={selected || undefined}>
      <div className="card-head">
        <StatusBadge cell={row.status} />
        <span className="chip" data-origin={row.origin}>{row.originLabel}</span>
        {row.uncertain && <span className="chip tone-amber" data-testid="uncertain">{row.uncertain}</span>}
        {row.possiblyUnseen && <StatusBadge cell={row.possiblyUnseen} />}
        <a href={sessionHref(row.sessionId)}>{row.session}</a><span className="grow" /><span className="faint tnum">{row.age}</span>
      </div>
      <button type="button" className={`card-text request-select${row.withheld ? ' withheld' : ''}`} title={row.text} aria-label={`Show details for ${row.text}`} aria-pressed={selected}
        onClick={event => { event.stopPropagation(); onSelect(); }}>{row.text}</button>
      {row.answer && <blockquote className="answer"><span className="faint small">Answer · {row.answer.age} ago</span><p className={row.answer.withheld ? 'withheld' : undefined}>{row.answer.text}</p></blockquote>}
    </li>
  );
}
