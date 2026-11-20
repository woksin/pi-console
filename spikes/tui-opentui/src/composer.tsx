import { useRef, useState } from 'react';
import { useKeyboard } from '@opentui/react';
import type { TextareaRenderable } from '@opentui/core';
import { clip, type Intervention, type Session, type State } from './model.ts';
import { interventionInput, modes, type InterventionInput, type Mode } from './signature-model.ts';
import { useMotion } from './motion.ts';
import { status, type Theme } from './theme.ts';

export function Composer({ state, session, width, height, t, submit, close }: { state: State; session: Session; width: number; height: number; t: Theme; submit: (input: InterventionInput) => Promise<Intervention>; close: () => void }) {
  const [mode, setMode] = useState<Mode>('steer');
  const [confirmation, setConfirmation] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [recorded, setRecorded] = useState<Intervention>();
  const editor = useRef<TextareaRenderable>(null);
  const motion = useMotion(session.id, 650);
  const question = state.questions.find(q => q.sessionId === session.id && q.status === 'open');
  const request = state.requests.filter(r => r.sessionId === session.id).at(-1);
  const audit = state.interventions.find(i => i.id === recorded?.id);
  const send = async () => {
    if (pending || recorded) return;
    setError('');
    try {
      const input = interventionInput(session, mode, editor.current?.plainText ?? text, question?.id, confirmation);
      setPending(true);
      setRecorded(await submit(input));
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setPending(false); }
  };
  useKeyboard(key => {
    if (key.name === 'escape') close();
    if (key.name === 'tab' && !recorded) { setMode(modes[(modes.indexOf(mode) + (key.shift ? 4 : 1)) % modes.length]); setError(''); }
    if (key.ctrl && key.name === 's') void send();
  });
  const panelWidth = Math.min(96, width - 6);
  const panelHeight = Math.min(26, height - 4);
  return <box position="absolute" left={Math.floor((width - panelWidth) / 2)} top={Math.max(1, Math.floor((height - panelHeight) / 2) + Math.round((1 - motion) * 4))} width={panelWidth} height={panelHeight} border borderStyle="rounded" borderColor={mode === 'abort' ? t.red : t.cyan} backgroundColor={t.raised} paddingX={2} paddingY={1} flexDirection="column" title=" INTERVENTION / HUMAN IN THE LOOP ">
    <box height={2} flexDirection="row"><text fg={t.cyan}><strong>{session.repositoryId.toUpperCase()} / {session.laneId}</strong></text><box flexGrow={1} /><text fg={status(t, session.status)[1]}>{status(t, session.status)[0]} {session.status}</text></box>
    <text height={1} fg={t.faint}>LAST REQUEST / {request?.origin === 'human' ? 'Human request' : request?.origin === 'launch' ? 'Initial prompt' : 'Unproven origin'}</text>
    <text height={2} fg={t.text}>{clip(request?.text ?? 'No request recorded.', (panelWidth - 10) * 2)}</text>
    <box height={3} flexDirection="row" gap={1}>
      {modes.map((value, i) => <box key={value} backgroundColor={mode === value ? t.select : t.panel} height={1} paddingX={1} onMouseDown={() => !recorded && setMode(value)}><text fg={mode === value ? value === 'abort' ? t.red : t.cyan : t.muted}>{i + 1} {value === 'followUp' ? 'follow-up' : value === 'nextTurn' ? 'next-turn' : value}</text></box>)}
    </box>
    {recorded ? <box flexGrow={1} flexDirection="column" gap={1}>
      <text fg={t.green}><strong>✓ Accepted by mock daemon / HTTP 202</strong></text>
      <text fg={audit ? t.green : t.amber}>{audit ? '● intervention.recorded arrived on SSE' : '◌ Waiting for intervention.recorded on SSE…'}</text>
      <text fg={t.text}>{recorded.id} · {recorded.type} · {recorded.sessionId}</text>
      <text fg={t.muted}>{clip(recorded.text || 'Abort requested with lane confirmation.', panelWidth - 10)}</text>
      <text fg={t.amber}>Audit only. No command delivered; no session changed.</text>
    </box> : <>
      {mode === 'answer' && <text height={2} fg={t.amber}>{clip(question?.text ?? 'No open question for this session.', panelWidth - 10)}</text>}
      {mode === 'abort' ? <box flexGrow={1} flexDirection="column" gap={1}>
        <text fg={t.red}><strong>Abort requires explicit lane confirmation.</strong></text>
        <text fg={t.muted}>Type {session.laneId} below. In this mock, only an audit is recorded.</text>
        <input focused value={confirmation} onInput={setConfirmation} placeholder={`Confirm ${session.laneId}`} backgroundColor={t.bg} textColor={t.red} />
      </box> : <box flexGrow={1} backgroundColor={t.bg} padding={1}>
        <textarea ref={editor} focused initialValue={text} onContentChange={() => setText(editor.current?.plainText ?? '')} placeholder="Write with intent. Enter adds a line…" textColor={t.text} backgroundColor={t.bg} focusedBackgroundColor={t.bg} flexGrow={1} keyBindings={[{ name: 's', ctrl: true, action: 'submit' }]} onSubmit={() => void send()} />
      </box>}
      <text height={1} fg={error ? t.red : t.faint}>{error || `${text.length}/10,000 · ${mode === 'answer' ? question?.id ?? 'no question' : 'target locked to ' + session.id}`}</text>
    </>}
    <box height={2} paddingTop={1} flexDirection="row"><text fg={t.cyan} onMouseDown={() => void send()}>{pending ? '◌ Recording…' : recorded ? 'Esc close' : '↑ Ctrl+S submit'}</text><box flexGrow={1} /><text fg={t.muted}>Tab mode · Enter newline · Esc cancel</text></box>
  </box>;
}
