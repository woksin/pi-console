import type { RequestsRow } from '@pi-console/viewmodels';
import { sessionHref } from '../../app/routes.ts';
import { StatusBadge } from '../../ui/primitives.tsx';
import { useScrollIntoView } from '../../ui/hooks.ts';

/** One request in the list. Stored text is shown as text; the origin chip says "classified as", the uncertain and unseen labels are always visible. */
export function RequestCard({ row, selected, onSelect }: { row: RequestsRow; selected: boolean; onSelect: () => void }) {
  const ref = useScrollIntoView<HTMLLIElement>(selected);
  return (
    <li ref={ref} className={`card tone-${row.status.color}${selected ? ' selected' : ''}`} onClick={onSelect} data-request={row.id} aria-current={selected || undefined}>
      <div className="card-head">
        <StatusBadge cell={row.status} />
        <span className="chip" data-origin={row.origin}>{row.originLabel}</span>
        {row.uncertain && <span className="chip tone-amber" data-testid="uncertain">{row.uncertain}</span>}
        {row.possiblyUnseen && <StatusBadge cell={row.possiblyUnseen} />}
        <a href={sessionHref(row.sessionId)}>{row.session}</a><span className="grow" /><span className="faint tnum">{row.age}</span>
      </div>
      <p className={`card-text${row.withheld ? ' withheld' : ''}`}>{row.text}</p>
      {row.answer && <blockquote className="answer"><span className="faint small">Answer · {row.answer.age} ago</span><p className={row.answer.withheld ? 'withheld' : undefined}>{row.answer.text}</p></blockquote>}
    </li>
  );
}
