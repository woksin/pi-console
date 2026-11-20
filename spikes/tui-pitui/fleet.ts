import { Model, activity, fleetRows, origin, type Session } from './model.ts';
import { Paint, clean, compact, fit, spark, statuses } from './paint.ts';

export type FleetHit = { y: number; id: string };

function sessionRow(model: Model, p: Paint, session: Session, width: number) {
  const [glyph, color] = statuses[session.status] ?? ['?', 'muted'];
  const selected = model.selected === session.id;
  const nameWidth = width > 106 ? 22 : 16;
  const activityWidth = Math.max(8, width - nameWidth - 49);
  const sample = session.samples.at(-1)!;
  const tree = session.parentSessionId ? '└ ' : '';
  const role = { orchestrator: 'orch', main: 'main', subagent: 'sub' }[session.role] ?? 'lane';
  const age = Math.max(0, Math.round((Date.parse(session.updatedAt) - Date.parse(session.startedAt)) / 60000));
  const row = p.text(selected ? '▸ ' : `${glyph} `, color, selected)
    + p.text(fit(session.laneId, 6), selected ? 'cyan' : 'text')
    + p.text(fit(tree + clean(session.name).replace(session.repositoryId + ' ', ''), nameWidth), selected ? 'text' : 'muted', selected)
    + p.text(fit(role, 6), 'dim')
    + p.text(fit(clean(activity(model, session)), activityWidth), color)
    + ' ' + p.text(spark(session.samples.map(point => point.contextPercent), 6), session.contextPercent > 75 ? 'amber' : 'cyan')
    + p.text(fit(`${session.contextPercent}%`, 5), 'muted')
    + p.text(fit(`$${sample.costUsd.toFixed(2)}`, 7), 'text')
    + p.text(fit(compact(sample.tokens), 6), 'muted')
    + p.text(`${age}m`, 'dim');
  const changed = Date.now() - (model.changed.get(session.id) ?? 0);
  const background = selected ? 'selected' : changed < 350 ? 'raised' : 'panel';
  return p.escape(background, true) + fit(row, width) + p.escape('panel', true);
}

export function attention(model: Model, p: Paint, width: number) {
  const requests = model.data.requests.filter(request => ['interrupted', 'unanswered'].includes(request.status));
  const questions = model.data.questions.filter(question => question.blocking && question.status === 'open');
  const rows = [p.text(`! NEEDS YOU  ${requests.length + questions.length}`, 'amber', true) + p.text('   decisions before activity', 'dim')];
  for (const question of questions.slice(0, 1)) rows.push(p.text(`▎ ${question.id.toUpperCase()} `, 'amber') + fit(clean(question.text), width - 7));
  for (const request of requests.slice(0, 1)) rows.push(p.text(`▎ ${request.id.toUpperCase()} / INTERRUPTED `, 'magenta') + fit(clean(request.text), width - 22));
  if (rows.length === 1) rows.push(p.text('Nothing needs you. Your fleet is moving.', 'green'));
  return rows;
}

export function fleetPanel(model: Model, p: Paint, width: number, height: number) {
  const body = attention(model, p, width - 4);
  body.push('', p.rule('REPOSITORY / LANE   ·   ACTIVITY   ·   CONTEXT / COST', width - 4));
  const available = height - 2 - body.length;
  const rows = fleetRows(model);
  const selectedIndex = rows.findIndex(row => row.session?.id === model.selected);
  if (selectedIndex < model.fleetOffset) model.fleetOffset = Math.max(0, selectedIndex);
  if (selectedIndex >= model.fleetOffset + available) model.fleetOffset = selectedIndex - available + 1;
  model.fleetOffset = Math.max(0, model.fleetOffset);
  const hits: FleetHit[] = [];
  rows.slice(model.fleetOffset, model.fleetOffset + available).forEach(row => {
    if (row.label) body.push(p.text('⌄ ' + clean(row.label), 'blue', true));
    if (row.session) {
      hits.push({ y: body.length + 1, id: row.session.id });
      body.push(sessionRow(model, p, row.session, width - 4));
    }
  });
  return {
    lines: p.box(`01  FLEET${model.needsOnly ? ' / needs-you' : ''}  ${model.sessions.length}`, body, width, height, model.focus === 0),
    hits,
  };
}

export function preview(model: Model, p: Paint, width: number, height: number) {
  const session = model.session;
  const body: string[] = [];
  if (!session) return p.box('SESSION PREVIEW', ['Waiting for snapshot…'], width, height);
  body.push(p.text(clean(session.name), 'text', true), p.badge(session.status) + p.text(`  ${session.laneId} · ${session.role}`, 'muted'));
  body.push(p.text(clean(session.model) + `  ctx ${session.contextPercent}%`, 'dim'), '');
  for (const request of model.data.requests.filter(item => item.sessionId === session.id).slice(0, 3)) {
    body.push(p.text(`${request.status === 'interrupted' ? '/' : '›'} ${request.id} · ${origin(request)} · ${request.status}`, request.status === 'interrupted' ? 'magenta' : 'amber', true));
    body.push(...p.wrap(request.text, width - 4).slice(0, 2));
    if (request.answer) body.push(...p.wrap('↳ ' + request.answer.text, width - 4, 'green').slice(0, 2));
    else body.push(p.text('↳ no final answer recorded', 'dim'));
    body.push('');
  }
  for (const question of model.data.questions.filter(item => item.sessionId === session.id && item.status === 'open').slice(0, 1)) {
    body.push(p.text(`! ${question.kind.toUpperCase()} / ${question.urgency}`, 'amber', true));
    body.push(...p.wrap(question.text, width - 4, 'amber'));
  }
  if (body.length < 6) body.push(...p.wrap('No requests recorded for this session. Select L192 for the live transcript fixture.', width - 4, 'muted'));
  return p.box('02  SELECTED / ⏎ inspect', body.slice(model.railOffset), width, height, model.focus === 1);
}

export function burn(model: Model, p: Paint, width: number, height: number) {
  const sessions = model.data.sessions;
  const values = Array.from({ length: 24 }, (_, i) => sessions.reduce((sum, session) => sum + session.samples[i].tokens, 0));
  const costs = sessions.reduce((sum, session) => sum + session.samples.at(-1)!.costUsd, 0);
  const max = Math.max(1, ...values);
  const chartWidth = Math.max(1, width - 11);
  const chartHeight = Math.max(2, height - 7);
  const body = [p.text(`${compact(values.at(-1) ?? 0)} tokens / min`, 'cyan', true) + p.text(`  $${costs.toFixed(2)}`, 'muted')];
  for (let y = 0; y < chartHeight; y++) {
    const label = y === 0 ? compact(max) : y === chartHeight - 1 ? '0' : '';
    let line = p.text(fit(label, 5) + '┊', 'dim');
    for (let x = 0; x < chartWidth; x++) {
      const value = values[Math.min(23, Math.floor(x / chartWidth * 24))] / max * chartHeight;
      const fill = Math.max(0, Math.min(8, Math.round((value - (chartHeight - y - 1)) * 8)));
      line += p.text(fill ? '▁▂▃▄▅▆▇█'[fill - 1] : ' ', y < chartHeight / 2 ? 'cyan' : 'blue');
    }
    body.push(line);
  }
  body.push(p.text('     └' + '─'.repeat(chartWidth), 'line'), p.text('      −23m' + ' '.repeat(Math.max(1, chartWidth - 10)) + 'now', 'dim'));
  body.push(p.text('▰ all repositories · fixture samples', 'muted'));
  return p.box('03  TOKEN BURN', body, width, height);
}
