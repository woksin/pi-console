import type { ReactNode } from 'react';
import { pressureThresholds, type Badge, type Pressure } from '@pi-console/viewmodels';

export function StatusBadge({ badge, compact = false }: { badge: Badge; compact?: boolean }) {
  return (
    <span className={`badge tone-${badge.color}`} data-status={badge.status} title={badge.label}>
      <span className="badge-glyph" aria-hidden="true">{badge.glyph}</span>
      <span className={compact ? 'badge-label sr-only' : 'badge-label'}>{badge.label}</span>
    </span>
  );
}

/** Context-pressure bar: green→amber→red gradient, soft and handoff thresholds drawn as ticks. */
export function PressureBar({ pressure, wide = false }: { pressure: Pressure; wide?: boolean }) {
  return (
    <span className={`pressure level-${pressure.level}${wide ? ' wide' : ''}`} role="img" aria-label={`Context ${pressure.label}`}>
      <span className="pressure-track">
        <span className="pressure-fill" style={{ width: `${String(pressure.percent)}%` }} />
        <span className="pressure-tick" style={{ left: `${String(pressureThresholds.soft)}%` }} />
        <span className="pressure-tick" style={{ left: `${String(pressureThresholds.handoff)}%` }} />
      </span>
      <span className="pressure-label">{pressure.label}</span>
    </span>
  );
}

export interface SparklineProps { values: readonly number[]; width?: number; height?: number; marks?: readonly number[]; fill?: boolean; tone?: string; label: string }

/** SVG sparkline over the same numbers the TUI draws as block glyphs. `marks` are sample indexes drawn as vertical ticks. */
export function Sparkline({ values, width = 96, height = 24, marks = [], fill = false, tone = 'cyan', label }: SparklineProps) {
  if (values.length < 2) return <svg className="spark" width={width} height={height} role="img" aria-label={`${label}: no data`} />;
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  const x = (index: number): number => index / (values.length - 1) * (width - 2) + 1;
  const y = (value: number): number => height - 2 - (value - low) / span * (height - 4);
  const line = values.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(' ');
  return (
    <svg className={`spark tone-${tone}`} width={width} height={height} viewBox={`0 0 ${String(width)} ${String(height)}`} role="img" aria-label={`${label}: ${String(values.length)} samples, latest ${String(values.at(-1))}`}>
      {fill && <path d={`${line} L${String(width - 1)} ${String(height)} L1 ${String(height)} Z`} className="spark-fill" />}
      <path d={line} className="spark-line" />
      {marks.map(index => <line key={index} x1={x(index)} x2={x(index)} y1={0} y2={height} className="spark-mark" />)}
    </svg>
  );
}

export function EmptyState({ title, children, mark = '○' }: { title: string; children?: ReactNode; mark?: string }) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden="true">{mark}</div>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: readonly { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map(tab => (
        <button key={tab.id} type="button" role="tab" aria-selected={tab.id === value} className="tab" onClick={() => { onChange(tab.id); }}>
          {tab.label}{tab.count !== undefined && <span className="tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>;

export function Panel({ title, aside, children, className = '' }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-head"><h3>{title}</h3>{aside && <span className="panel-aside">{aside}</span>}</header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function SearchBox({ value, onChange, placeholder, inputRef }: { value: string; onChange: (value: string) => void; placeholder: string; inputRef?: React.RefObject<HTMLInputElement | null> }) {
  return (
    <label className="search">
      <span className="sr-only">{placeholder}</span>
      <input ref={inputRef} type="search" value={value} placeholder={placeholder} spellCheck={false} autoComplete="off"
        onChange={event => { onChange(event.target.value); }}
        onKeyDown={event => { if (event.key === 'Escape') { if (value) onChange(''); event.currentTarget.blur(); } }} />
      <Kbd>/</Kbd>
    </label>
  );
}
