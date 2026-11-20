import type { TranscriptRow } from '@pi-console/viewmodels';
import { useEffect, useRef } from 'react';

function DiffText({ text }: { text: string }) {
  return (
    <pre className="diff">
      {text.split('\n').map((line, index) => {
        const kind = line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : line.startsWith('@@') ? 'hunk' : 'ctx';
        return <span key={index} className={`diff-${kind}`}>{line}{'\n'}</span>;
      })}
    </pre>
  );
}

function ToolBody({ row }: { row: TranscriptRow }) {
  const tool = row.tool;
  if (!tool) return null;
  return (
    <div className="tool-body">
      {tool.args && <pre className="args">{tool.args}</pre>}
      {tool.withheld && <p className="note warn">Result withheld: it looked like a secret.</p>}
      {!tool.withheld && tool.result && (tool.resultKind === 'diff' ? <DiffText text={tool.result} /> : <pre className={`result kind-${tool.resultKind}`}>{tool.result}</pre>)}
      {tool.truncated && <p className="note">Result truncated at the daemon.</p>}
    </div>
  );
}

function Body({ row }: { row: TranscriptRow }) {
  if (row.kind === 'diff') return <DiffText text={row.text} />;
  if (row.tool) return <ToolBody row={row} />;
  return <div className="text">{row.text}{row.streaming && <span className="caret" aria-hidden="true" />}</div>;
}

export function Entry({ row, onToggle }: { row: TranscriptRow; onToggle: (id: string) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (row.target) ref.current?.scrollIntoView({ block: 'center' }); }, [row.target]);
  if (row.reset) {
    return (
      <div ref={ref} className="reset-marker" role="separator" data-entry={row.id}>
        <span>{row.reset.kind} at {row.reset.at}</span>
        <small>{row.reset.carried.length} requests carried · {row.reset.interrupted.length} interrupted</small>
      </div>
    );
  }
  const cls = `entry kind-${row.kind}${row.match ? ' match' : ''}${row.target ? ' target' : ''}${row.collapsed ? ' collapsed' : ''}`;
  const toggle = row.expandable ? (
    <button type="button" className="entry-head" aria-expanded={!row.collapsed} onClick={() => { onToggle(row.id); }}>
      <span className="glyph" aria-hidden="true">{row.glyph}</span><span className="who">{row.tool?.name ?? row.label}</span>
      <span className="summary truncate">{row.collapsed ? row.summary : ''}</span><time className="tnum">{row.at}</time>
    </button>
  ) : (
    <div className="entry-head static"><span className="glyph" aria-hidden="true">{row.glyph}</span><span className="who">{row.label}</span><span className="grow" /><time className="tnum">{row.at}</time></div>
  );
  return (
    <div ref={ref} className={cls} data-entry={row.id} data-kind={row.kind}>
      {toggle}
      {!row.collapsed && <Body row={row} />}
      {row.requestId && <span className="request-tag" title="Request">{row.requestId}</span>}
    </div>
  );
}
