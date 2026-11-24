import type { EvidenceRow, RequestDetail } from '@pi-console/viewmodels';
import { sessionHref } from '../../app/routes.ts';
import { Panel, StatusBadge } from '../../ui/primitives.tsx';

const Lines = ({ lines, withheld }: { lines: readonly string[]; withheld: boolean }) => (
  <div className={`detail-text${withheld ? ' withheld' : ''}`}>{lines.map((line, index) => <p key={index}>{line}</p>)}</div>
);

function Evidence({ item }: { item: EvidenceRow }) {
  return (
    <li data-evidence={item.label}>
      <span>{item.label}</span> <span className="faint tnum">{item.age} ago</span>
      {item.resetId && <span className="chip">reset {item.resetId}</span>}
      {item.transcript && <> <a href={sessionHref(item.transcript.sessionId, item.transcript.entryId)} data-testid="evidence-jump">Open in transcript →</a></>}
    </li>
  );
}

/** The selected request in full: text, answer, why the state is what it is, and the way into the transcript. Read-only. */
export function RequestDetailPane({ detail }: { detail: RequestDetail }) {
  const link = detail.transcript;
  return (
    <aside className="request-detail" aria-label="Request detail">
      <Panel title="Request" aside={<StatusBadge cell={detail.status} />}>
        <Lines lines={detail.textLines} withheld={detail.withheld} />
        <p className="small">{detail.provenance} <span className="muted">({detail.provenanceQualifier})</span></p>
        <p className="muted small">Evidence: {detail.originEvidence}</p>
        {detail.uncertain && <p className="uncertain" data-testid="detail-uncertain">{detail.uncertain}</p>}
        {detail.possiblyUnseen && <p className="uncertain"><StatusBadge cell={detail.possiblyUnseen} /> The answer may have been lost at a reset.</p>}
        {link && <a className="btn" href={sessionHref(link.sessionId, link.entryId)} data-testid="request-jump">Open in transcript →</a>}
      </Panel>
      <Panel title="Answer" aside={detail.answer ? `${detail.answer.age} ago` : undefined}>
        {detail.answer ? <Lines lines={detail.answerLines} withheld={detail.answer.withheld} /> : <span className="muted">No final answer recorded.</span>}
        {detail.interim.map((item, index) => <blockquote key={index} className="answer partial"><span className="faint small">Partial answer, not final · {item.age} ago</span><p>{item.text}</p></blockquote>)}
      </Panel>
      <Panel title="Evidence" aside={detail.source}>
        {detail.evidence.length === 0 ? <span className="muted">No evidence recorded by the source.</span> : <ul className="evidence">{detail.evidence.map((item, index) => <Evidence key={index} item={item} />)}</ul>}
      </Panel>
    </aside>
  );
}
