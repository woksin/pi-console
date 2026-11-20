import { compositeTuiLine, fuzzyFilter, matchesKey, type Component, type TuiMouseEvent } from '@earendil-works/pi-tui';
import { Model, fleetRows } from './model.ts';
import { Paint, clean, fit, type Depth } from './paint.ts';
import { burn, fleetPanel, preview, type FleetHit } from './fleet.ts';
import { Transcript, rail } from './transcript.ts';

type Action = { label: string; hint: string; run: () => void };

export class App implements Component {
  model: Model;
  paint: Paint;
  transcript = new Transcript();
  redraw = () => {};
  quit = () => {};
  open = (_id: string) => {};
  height = () => 36;
  width = 120;
  leftWidth = 76;
  fleetHits: FleetHit[] = [];
  overlay: 'palette' | 'help' | 'search' | undefined;
  query = '';
  choice = 0;
  private previousSearch = '';
  private lastRevision = -1;
  private lastSecond = -1;

  constructor(model: Model, depth: Depth) { this.model = model; this.paint = new Paint(depth); }
  invalidate() { this.lastRevision = -1; }

  tick() {
    const second = Math.floor(Date.now() / 1000);
    if (second !== this.lastSecond || this.lastRevision !== this.model.revision) {
      this.lastSecond = second;
      this.lastRevision = this.model.revision;
      this.redraw();
    }
  }

  actions(): Action[] {
    return [
      { label: 'Fleet overview', hint: '1', run: () => { this.model.screen = 'fleet'; } },
      { label: 'Filter needs-you / all sessions', hint: '!', run: () => this.toggleNeeds() },
      { label: 'Toggle theme: Midnight / Contrast', hint: 't', run: () => { this.paint.contrast = !this.paint.contrast; } },
      { label: 'Follow live transcript', hint: 'f', run: () => this.model.tail() },
      ...this.model.data.sessions.map(session => ({
        label: `Go to session ${session.laneId} · ${session.name}`, hint: session.id,
        run: () => this.openSession(session.id),
      })),
      { label: 'Quit console (agents keep running)', hint: 'q', run: () => this.quit() },
    ];
  }

  results() { return fuzzyFilter(this.actions(), this.query, action => action.label); }

  openSession(id: string) {
    this.model.select(id);
    this.model.screen = 'detail';
    this.model.focus = 0;
    this.open(id);
  }

  toggleNeeds() {
    this.model.needsOnly = !this.model.needsOnly;
    if (!this.model.sessions.some(session => session.id === this.model.selected)) {
      const first = this.model.sessions[0];
      if (first) this.model.select(first.id);
    }
  }

  private navigate(delta: number) {
    if (this.model.focus === 1) { this.model.railOffset = Math.max(0, this.model.railOffset + delta); return; }
    if (this.model.screen === 'detail') { this.model.scroll(-delta * 3); return; }
    const sessions = fleetRows(this.model).flatMap(row => row.session ? [row.session] : []);
    const index = sessions.findIndex(session => session.id === this.model.selected);
    const next = sessions[Math.max(0, Math.min(sessions.length - 1, index + delta))];
    if (next) this.model.select(next.id);
  }

  handleInput(data: string) {
    if (matchesKey(data, 'ctrl+c')) { this.quit(); return; }
    if (this.overlay) { this.overlayInput(data); this.redraw(); return; }
    const commands: [boolean, () => void][] = [
      [matchesKey(data, 'ctrl+p') || data === ':', () => { this.overlay = 'palette'; this.query = ''; this.choice = 0; }],
      [data === '?', () => { this.overlay = 'help'; }],
      [data === '/', () => { this.previousSearch = this.model.search; this.query = this.model.search; this.overlay = 'search'; }],
      [matchesKey(data, 'escape'), () => { if (this.model.search) this.model.search = ''; else this.model.screen = 'fleet'; }],
      [data === 'q', () => this.quit()],
      [matchesKey(data, 'tab') || matchesKey(data, 'shift+tab'), () => { this.model.focus = 1 - this.model.focus; }],
      [data === 'j' || matchesKey(data, 'down'), () => this.navigate(1)],
      [data === 'k' || matchesKey(data, 'up'), () => this.navigate(-1)],
      [matchesKey(data, 'pageUp'), () => this.navigate(-6)],
      [matchesKey(data, 'pageDown'), () => this.navigate(6)],
      [data === 'f' || data === 'G', () => this.model.tail()],
      [data === 'g', () => { if (this.model.screen === 'detail') this.model.scroll(100000); else this.navigate(-1000); }],
      [data === '!', () => this.toggleNeeds()],
      [data === 't', () => { this.paint.contrast = !this.paint.contrast; }],
      [data === '1', () => { this.model.screen = 'fleet'; }],
      [data === 'r', () => this.boundary()],
      [matchesKey(data, 'return') || data === ' ', () => this.enter()],
    ];
    commands.find(([matches]) => matches)?.[1]();
    this.redraw();
  }

  private enter() {
    if (this.model.screen === 'fleet') { this.openSession(this.model.selected); return; }
    const entry = this.transcript.current;
    if (!entry) return;
    if (this.model.expanded.has(entry.id)) this.model.expanded.delete(entry.id);
    else this.model.expanded.add(entry.id);
  }

  private boundary() {
    const entry = this.model.transcript.findLast(item => item.kind === 'reset');
    if (!entry) return;
    this.model.follow = false;
    this.model.search = '';
    this.transcript.seek = entry.cursor;
  }

  private overlayInput(data: string) {
    if (matchesKey(data, 'escape')) {
      if (this.overlay === 'search') this.model.search = this.previousSearch;
      this.overlay = undefined;
      return;
    }
    if (this.overlay === 'help') { this.overlay = undefined; return; }
    if (matchesKey(data, 'return')) {
      if (this.overlay === 'palette') this.results()[this.choice]?.run();
      this.overlay = undefined;
      return;
    }
    if (matchesKey(data, 'down')) { this.choice = Math.min(this.results().length - 1, this.choice + 1); return; }
    if (matchesKey(data, 'up')) { this.choice = Math.max(0, this.choice - 1); return; }
    if (matchesKey(data, 'backspace')) this.query = this.query.slice(0, -1);
    else if (data.length === 1 && data >= ' ') this.query += data;
    this.choice = 0;
    if (this.overlay === 'search') { this.model.search = this.query; this.model.offset = 0; }
  }

  handleMouse(event: TuiMouseEvent) {
    if (this.overlay) return { handled: true };
    this.model.focus = event.x < this.leftWidth ? 0 : 1;
    if (event.type === 'wheel') {
      this.navigate(event.wheelDelta ?? 0);
      this.redraw();
      return { handled: true };
    }
    if (event.type !== 'click') return { handled: true };
    if (this.model.screen === 'fleet' && this.model.focus === 0) {
      const hit = this.fleetHits.find(row => row.y === event.y - 4);
      if (hit) {
        this.model.select(hit.id);
        if ((event.clickCount ?? 1) > 1) this.openSession(hit.id);
      }
    } else if (this.model.screen === 'detail' && this.model.focus === 0) {
      const hit = this.transcript.hits.find(row => row.y === event.y - 4);
      if (hit) { this.transcript.current = hit.entry; this.enter(); }
    }
    this.redraw();
    return { handled: true };
  }

  private header(width: number) {
    const p = this.paint;
    const m = this.model;
    const clock = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const right = p.text(m.connected ? '● CONNECTED' : '○ RECONNECTING', m.connected ? 'green' : 'red') + p.text('  ' + clock, 'muted');
    const title = p.gradient('pi-console') + p.text('  /  MISSION CONTROL', 'muted');
    const first = '  ' + fit(title, Math.max(1, width - 26)) + right;
    const counts = ['working', 'needs-you', 'blocked', 'failed'].map(status => {
      const count = m.data.sessions.filter(session => session.status === status).length;
      return p.escape('raised', true) + ' ' + p.badge(status) + p.text(` ${count} `, 'text', true) + p.escape('bg', true);
    }).join('  ');
    const session = m.session;
    const detail = session ? p.text(`${clean(session.laneId)} / ${clean(session.name)}  `, 'text', true) + p.badge(session.status) + p.text(`  ${clean(session.model)}  ctx ${session.contextPercent}%`, 'muted') : '';
    return [p.surface(first, width), p.surface('  ' + counts, width),
      p.surface('  ' + (m.screen === 'fleet' ? p.text('01 OVERVIEW', 'cyan', true) + p.text('   /   Fleet intelligence   /   synthetic local data', 'dim') : detail), width),
      p.surface(p.rule(m.screen === 'fleet' ? `${m.data.repositories.length} REPOSITORIES / ${m.data.sessions.length} SESSIONS` : 'SESSION DETAIL / READ ONLY', width, 'line'), width)];
  }

  render(width: number) {
    this.width = width;
    const height = Math.max(12, this.height());
    const p = this.paint;
    if (width < 76 || height < 20) return Array.from({ length: height }, (_, i) => p.surface(i === 2 ? '  pi-console · resize to at least 76 × 20' : i === 4 ? '  Ctrl+C quit · no session is stopped' : '', width));
    this.leftWidth = Math.floor((width - 1) * (width >= 160 ? 0.68 : 0.64));
    const rightWidth = width - this.leftWidth - 1;
    const panelHeight = height - 6;
    let left: string[];
    let right: string[];
    if (this.model.screen === 'fleet') {
      const fleet = fleetPanel(this.model, p, this.leftWidth, panelHeight);
      left = fleet.lines;
      this.fleetHits = fleet.hits;
      const chartHeight = Math.min(13, Math.max(8, Math.floor(panelHeight * 0.39)));
      right = [...preview(this.model, p, rightWidth, panelHeight - chartHeight), ...burn(this.model, p, rightWidth, chartHeight)];
    } else {
      left = this.transcript.render(this.model, p, this.leftWidth, panelHeight);
      right = rail(this.model, p, rightWidth, panelHeight);
    }
    const lines = this.header(width);
    for (let i = 0; i < panelHeight; i++) lines.push(left[i] + p.surface(' ', 1) + right[i]);
    const hints = this.model.screen === 'fleet' ? ' j/k move   ⏎ inspect   ! needs-you   Tab pane   / search' : ' ↑↓ scroll   ⏎ expand   f follow   r reset   / search   Esc fleet';
    lines.push(p.surface(p.text(hints, 'muted') + p.text('   : palette   ? help   q quit', 'cyan'), width, 'raised'));
    const transport = this.model.connected ? ` SSE #${this.model.sequence}  ·  ${this.model.received} events  ·  render ≤20 fps` : ` ${clean(this.model.error)}`;
    lines.push(p.surface(p.text(transport, this.model.connected ? 'dim' : 'red') + p.text('  /  MOCK ONLY · no commands delivered', 'dim'), width));
    return this.overlay ? this.composeOverlay(lines, width) : lines;
  }

  private composeOverlay(lines: string[], width: number) {
    const p = this.paint;
    const overlayWidth = Math.min(74, width - 8);
    let body: string[];
    if (this.overlay === 'help') body = [
      p.gradient('A calmer view of a busy fleet.'), '',
      'j/k · arrows    Navigate sessions / scroll transcript',
      'Enter          Inspect session / expand visible event',
      'Tab            Switch focus between panes',
      'Mouse          Select · double click opens · wheel scrolls',
      'f / G          Resume follow-tail, clear new-entry counter',
      'g / r          Oldest retained entry / latest reset boundary',
      '/              Search transcript text (live filter)',
      '!              Toggle needs-you sessions',
      'Ctrl+P / :     Fuzzy command palette',
      't              Midnight / high-contrast theme',
      'Esc / q        Back / quit (agents are never stopped)', '',
      p.text('Read-only mock client · unverified origins stay unverified.', 'amber'),
    ];
    else if (this.overlay === 'search') body = [p.text('Search transcript text', 'muted'), '', p.text(' / ' + clean(this.query) + '▏', 'cyan', true), '', p.text('Enter keep · Esc cancel · Esc again clears', 'dim')];
    else body = [p.text(' > ' + clean(this.query) + '▏', 'cyan', true), p.rule('COMMANDS / SESSIONS', overlayWidth - 4),
      ...this.results().slice(Math.max(0, this.choice - 7), Math.max(0, this.choice - 7) + 8).map((action, index) => {
        const selected = index + Math.max(0, this.choice - 7) === this.choice;
        return p.text((selected ? '▸ ' : '  ') + fit(clean(action.label), overlayWidth - 13), selected ? 'cyan' : 'text', selected) + p.text(action.hint, 'dim');
      }), '', p.text('↑↓ choose   ⏎ run   Esc dismiss', 'dim')];
    const box = p.box(this.overlay === 'help' ? 'KEYBOARD / FIELD GUIDE' : this.overlay === 'search' ? 'TRANSCRIPT SEARCH' : 'COMMAND PALETTE', body, overlayWidth, body.length + 2, true);
    const top = Math.max(1, Math.floor((lines.length - box.length) / 2));
    const col = Math.floor((width - overlayWidth) / 2);
    box.forEach((line, index) => { lines[top + index] = compositeTuiLine(lines[top + index], line, col, overlayWidth, width); });
    return lines;
  }
}
