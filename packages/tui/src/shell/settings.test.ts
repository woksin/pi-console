import { test } from 'node:test';
import assert from 'node:assert/strict';
import { App } from '../app.ts';
import { countsOf } from '../app-input.ts';
import { Store } from '../store/store.ts';
import { h, mountHeadless } from '../view/renderer.ts';
import { healthTimestamp } from '@pi-console/viewmodels';
import { settingsViewport } from './overlays.ts';

async function settingsAt(size: { width: number; height: number }, health?: Record<string, unknown>) {
  const store = new Store();
  if (health) store.setHealth(health);
  const input = { endpoint: 'http://localhost', tokenSource: 'test', ...store.getSnapshot().connection, now: 0, counts: countsOf(store.getSnapshot()) };
  const ui = await mountHeadless(h(App, { store, endpoint: input.endpoint, tokenSource: input.tokenSource, animate: false, clock: () => 0, loadTranscript: () => undefined, loadMemory: () => undefined, onQuit: () => undefined }), size);
  await ui.settle();
  await ui.press(',');
  return { ui, input, destroy: () => { ui.destroy(); store.dispose(); } };
}

const textOf = (frame: string): string => frame.replace(/[│\s]+/g, ' ');

/** Collect each logical content line from the real headless frame, without overlapping scroll pages. */
async function scrollSettings({ ui, viewport }: { ui: Awaited<ReturnType<typeof settingsAt>>['ui']; viewport: ReturnType<typeof settingsViewport> }): Promise<string[]> {
  const rendered: string[] = [];
  for (let offset = 0; offset <= viewport.bounds.max; offset++) {
    const frame = ui.frame().split('\n');
    const first = viewport.box.top + 1;
    const rows = offset === 0 ? frame.slice(first, first + viewport.bounds.page) : [frame[first + viewport.bounds.page - 1]];
    rendered.push(...rows.map(row => row.slice(viewport.box.left + 2, viewport.box.left + viewport.box.width - 2).trimEnd()));
    await ui.press('ARROW_DOWN');
  }
  return rendered;
}

for (const size of [{ width: 80, height: 24 }, { width: 60, height: 16 }]) {
  test(`${size.width}x${size.height}: Settings keyboard scrolling reaches every row and shows its position`, async () => {
    const { ui, input, destroy } = await settingsAt(size);
    try {
      const viewport = settingsViewport(size, input);
      const { page, max } = viewport.bounds;
      const first = ui.frame();
      assert.equal(viewport.lines.length, 25);
      assert.equal(page, size.height - 4);
      assert.ok(first.includes(`1–${page} of 25`));
      assert.match(first, /↑↓ PgUp\/PgDn Home\/End · esc closes/);
      assert.doesNotMatch(first, /context ramp/);
      let seen = first;
      for (let line = 0; line < max; line++) { await ui.press('ARROW_DOWN'); seen += ui.frame(); }
      for (const line of viewport.lines) {
        const text = line.map(part => part.text).join('').slice(0, 32).trim();
        assert.ok(textOf(seen).includes(textOf(text)), text);
      }
      const last = ui.frame();
      assert.ok(last.includes(`${max + 1}–25 of 25`));
      assert.match(last, /context ramp/);
      await ui.press('ARROW_DOWN');
      assert.equal(ui.frame(), last, 'clamped at the end');
      await ui.press('HOME');
      assert.equal(ui.frame(), first);
      await ui.press('ESCAPE');
      assert.doesNotMatch(ui.frame(), /Settings/);
      await ui.press(',');
      assert.equal(ui.frame(), first, 'reopening resets scroll');
    } finally { destroy(); }
  });

  test(`${size.width}x${size.height}: Settings accepts Help's scrolling keys without moving the underlying view`, async () => {
    const { ui, destroy } = await settingsAt(size);
    try {
      const first = ui.frame();
      for (const [down, up] of [['ARROW_DOWN', 'ARROW_UP'], ['j', 'k'], ['\u001b[6~', '\u001b[5~']]) {
        await ui.press(down);
        assert.notEqual(ui.frame(), first, down);
        await ui.press(up);
        assert.equal(ui.frame(), first, up);
      }
      await ui.press('END');
      const last = ui.frame();
      await ui.press('g');
      assert.equal(ui.frame(), first);
      await ui.press('G');
      assert.equal(ui.frame(), last);
      await ui.press('?');
      assert.match(ui.frame(), /KEYBOARD MAP/);
      await ui.press('ESCAPE');
      await ui.press(',');
      assert.equal(ui.frame(), first);
    } finally { destroy(); }
  });
}

test('Settings resize clamps the visible offset and the next key starts from that clamped position', async () => {
  const { ui, destroy } = await settingsAt({ width: 60, height: 16 });
  try {
    await ui.press('END');
    assert.ok(ui.frame().includes('14–25 of 25'));
    await ui.resize(80, 24);
    assert.ok(ui.frame().includes('6–25 of 25'));
    assert.match(ui.frame(), /context ramp/);
    await ui.press('ARROW_UP');
    assert.ok(ui.frame().includes('5–24 of 25'));
    await ui.resize(60, 16);
    assert.ok(ui.frame().includes('5–16 of 25'));
    await ui.press('END');
    assert.ok(ui.frame().includes('14–25 of 25'));
  } finally { destroy(); }
});

const plain = (size: { width: number; height: number }, health: Record<string, unknown> | null) => {
  const store = new Store();
  const input = { endpoint: 'http://localhost', tokenSource: 'test', ...store.getSnapshot().connection, now: 0, counts: countsOf(store.getSnapshot()) };
  store.dispose();
  return settingsViewport(size, input, health).lines.map(line => line.map(part => part.text).join(''));
};

test('Settings names a missing agent directory and source, then shows them available once the daemon reports so', () => {
  const size = { width: 80, height: 60 };
  const missing = plain(size, { status: 'degraded', agentRootAvailability: 'missing', sources: [{ source: 'issue-work', availability: 'missing' }] });
  assert.ok(missing.some(line => /^Agent directory\s+missing directory — check startup paths/.test(line)), missing.join('\n'));
  assert.ok(missing.some(line => /^Issue register\s+missing directory — check startup paths/.test(line)));
  assert.ok(missing.some(line => /^\s+issue-work\s*$/.test(line)), 'the daemon id stays as secondary text');
  const recovered = plain(size, { status: 'ok', agentRootAvailability: 'available', sources: [{ source: 'issue-work', availability: 'available' }] });
  assert.ok(recovered.some(line => /^Issue register\s+available/.test(line)));
  assert.ok(!recovered.some(line => line.includes('missing directory')));
});

test('Settings separates long diagnostic labels from numeric values at narrow widths', () => {
  const lines = plain({ width: 60, height: 40 }, { eventLog: { lastSeq: 42 }, memory: { rssBytes: 2_097_152 } });
  assert.ok(!lines.some(line => line.includes('Last sequence')), lines.join('\n'));
  assert.ok(lines.some(line => /Daemon head\s+42$/.test(line)), lines.join('\n'));
  assert.ok(lines.some(line => /memory\s+2\.0 MB$/.test(line)), lines.join('\n'));
});

for (const width of [60, 80, 120]) {
  test(`Settings aligns values across all sections at width ${width}, wrapping capped labels`, () => {
    const store = new Store();
    const input = { endpoint: 'endpoint-value', tokenSource: 'token-value', ...store.getSnapshot().connection, now: 0, counts: { sessions: 123 } };
    store.dispose();
    const health = { memory: { rssBytes: 2097152 }, eventLoop: { p50: 6.283263 }, backfill: { complete: true }, agentRootAvailability: 'available', sources: [{ source: 'issue-work', availability: 'available' }], veryLongDiagnosticLabelBeyondTheColumnCap: 'diagnostic-value' };
    const lines = settingsViewport({ width, height: 60 }, input, health).lines;
    const values = ['endpoint-value', 'token-value', '123', '2.0 MB', '6.3 ms', 'Complete', 'available', 'diagnostic-value'];
    const columns = lines.filter(line => values.includes(line[1]?.text)).map(line => {
      assert.match(line[0].text, / {2}$/);
      return line[0].text.length;
    });
    assert.equal(columns.length, values.length + 1, 'both source availability rows are checked');
    assert.equal(new Set(columns).size, 1);
    assert.ok(columns[0] <= 34, 'the label column is capped plus a two-space gap');
    const theme = lines.find(line => line[0]?.text.trim() === 'Theme' && line.length > 1);
    assert.equal(theme?.[0].text.length, columns[0]);
    assert.ok(lines.some(line => line[0]?.text.includes('Very Long Diagnostic')));
  });
}

for (const width of [60, 80, 120]) {
  test(`Settings source errors and complete poll times remain readable by scrolling at width ${width}`, async () => {
    const size = { width, height: 16 };
    const polled = '1970-01-01T00:00:00Z';
    const health = { eventLog: { lastSeq: 42 }, projection: { position: 40 }, sources: [{ source: 'session-jsonl', availability: 'available', files: 12, lagBytes: 0, errors: 2, lastPollAt: polled }] };
    const { ui, input, destroy } = await settingsAt(size, health);
    try {
      const viewport = settingsViewport(size, input, health);
      const start = viewport.lines.findIndex(line => line[0]?.text.trim() === 'Session transcripts');
      const end = viewport.lines.findIndex(line => line[0]?.text === '  session-jsonl');
      assert.ok(start >= 0 && end > start);
      const expected = viewport.lines.slice(start, end);
      const rendered = await scrollSettings({ ui, viewport });
      const source = rendered.slice(start, end);
      assert.deepEqual(source, expected.map(line => line.map(part => part.text).join('').trimEnd()), 'headless frames show every wrapped character');
      const indent = expected[0][0].text.length;
      assert.ok(source.slice(1).every(line => line.slice(0, indent) === ' '.repeat(indent)), 'continuations align with the value column');
      assert.equal(source.map(line => line.slice(indent).trim()).join(' '), `available · 12 files · no lag · 2 errors · polled ${healthTimestamp(polled, 0)}`);
      assert.ok(expected.some(line => line.some(part => part.text.includes('polled') && part.color === 'faint')));
      assert.match(rendered.join('\n'), /Daemon head\s+42/);
      assert.match(rendered.join('\n'), /Projection position\s+40/);
    } finally { destroy(); }
  });
}

test('Settings keeps availability neutral for a daemon that does not report it', () => {
  const lines = plain({ width: 80, height: 60 }, { status: 'ok', sources: [{ source: 'issue-work', files: 1 }] });
  assert.ok(lines.some(line => /^Source adapters\s+availability not reported/.test(line)) || lines.some(line => /^Issue register\s+availability not reported/.test(line)));
  assert.ok(!lines.some(line => /^Issue register\s+available\s*$/.test(line)));
});
