import type { ReactNode } from 'react';
import { clip, totals, type State, type Session } from './model.ts';
import { spark, status, type Theme } from './theme.ts';

export function Panel({ title, t, active = false, children, height, grow = 0 }: { title: string; t: Theme; active?: boolean; children: ReactNode; height?: number; grow?: number }) {
  return <box border borderStyle="rounded" borderColor={active ? t.cyan : t.border} title={` ${title} `} titleColor={active ? t.cyan : t.muted} backgroundColor={t.panel} paddingX={1} minHeight={0} height={height} flexGrow={grow} flexShrink={height ? 0 : 1} flexDirection="column" overflow="hidden">{children}</box>;
}
export function Label({ children, color }: { children: ReactNode; color: string }) { return <text height={1} fg={color}><strong>{children}</strong></text>; }
export function Burn({ state, t, width, height }: { state: State; t: Theme; width: number; height: number }) {
  const values = Array.from({ length: 24 }, (_, i) => state.sessions.reduce((sum, s) => sum + (s.samples[i]?.tokens ?? 0), 0));
  const max = Math.max(...values, 1);
  const rows = Math.max(2, height - 6);
  const columns = Math.max(10, width - 7);
  const total = totals(state.sessions);
  return <Panel title="FLEET / TOKEN BURN" t={t} height={height}>
    <text height={1} fg={t.text}><strong>{(total.tokens / 1000000).toFixed(2)}M tokens</strong><span fg={t.muted}>   ${total.cost.toFixed(2)} recorded</span></text>
    {Array.from({ length: rows }, (_, y) => <text key={y} height={1} fg={y < rows / 2 ? t.cyan : t.blue}>{Array.from({ length: columns }, (_, x) => {
      const value = values[Math.min(23, Math.floor(x / columns * 24))] / max * rows;
      const level = value - (rows - y - 1);
      return level >= 1 ? '█' : level > 0 ? '▁▂▃▄▅▆▇'[Math.min(6, Math.floor(level * 7))] : ' ';
    }).join('')}</text>)}
    <text height={1} fg={t.faint}>└ 09:00 ─── recorded samples ─── 09:23</text>
    <text height={1} fg={t.muted}>SSE {(state.received / 1000).toFixed(1)}k entries · 20 Hz UI</text>
  </Panel>;
}
export function Requests({ state, session, t, width, compact = false }: { state: State; session: Session; t: Theme; width: number; compact?: boolean }) {
  const requests = state.requests.filter(r => r.sessionId === session.id);
  const questions = state.questions.filter(q => q.sessionId === session.id && q.status === 'open');
  return <>
    <Label color={t.amber}>REQUESTS & ANSWERS  {requests.length}</Label>
    {!requests.length && <text fg={t.faint}>No requests observed</text>}
    {requests.map(r => {
      const [glyph, color] = status(t, r.status);
      return <box key={r.id} flexDirection="column" marginTop={1} flexShrink={0}>
        <text height={1} fg={color}><strong>{glyph} {r.id.toUpperCase()}  {r.status.toUpperCase()}</strong></text>
        <text height={1} fg={t.faint}>{r.origin === 'human' ? 'you' : r.origin === 'launch' ? 'initial prompt' : 'origin not verified'}</text>
        <text height={compact ? 1 : 2} fg={t.text}>{clip(r.text, (width - 6) * (compact ? 1 : 2))}</text>
        {r.answer && <text height={2} fg={t.green}>{clip('↳ ' + r.answer.text, (width - 6) * 2)}</text>}
        {!compact && r.interimAnswers.length > 0 && <text height={2} fg={t.pink}>{clip('↳ partial only · ' + r.interimAnswers[0].text, (width - 6) * 2)}</text>}
      </box>;
    })}
    {questions.length > 0 && <box marginTop={1} flexDirection="column" flexShrink={0}>
      <Label color={t.amber}>OPEN QUESTIONS  {questions.length}</Label>
      {questions.map(q => <text key={q.id} height={2} fg={t.text}>{clip(`${q.blocking ? '! blocking' : '◇ decision'} · ${q.text}`, (width - 6) * 2)}</text>)}
    </box>}
  </>;
}
export function Context({ session, t }: { session: Session; t: Theme }) {
  const color = session.contextPercent > 80 ? t.red : session.contextPercent > 60 ? t.amber : t.cyan;
  return <box flexDirection="column" marginTop={1} flexShrink={0}>
    <Label color={t.muted}>CONTEXT PRESSURE  {session.contextPercent}%</Label>
    <text height={1} fg={color}>{spark(session.samples.map(s => s.contextPercent))}</text>
    <text height={1} fg={t.faint}>{session.model}</text>
  </box>;
}
