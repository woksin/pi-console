import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sessionStatuses, statusTaxonomy, statusToken } from './status.ts';
import { highContrastOverrides, themeColors, themeTokens } from './theme.ts';
import { apiV0Schema } from './api.ts';

test('every v0 session status and request/job status word has a glyph, label and a real theme colour', () => {
  const session = (apiV0Schema.$defs.session as { properties: { status: { enum: string[] } } }).properties.status.enum;
  const job = (apiV0Schema.$defs.job as { properties: { status: { enum: string[] } } }).properties.status.enum;
  const request = (apiV0Schema.$defs.request as { properties: { status: { enum: string[] } } }).properties.status.enum;
  assert.deepEqual([...sessionStatuses], session);
  for (const word of [...session, ...job, ...request, 'answer-possibly-unseen']) {
    const token = statusToken(word);
    assert.notEqual(token.label, 'Unknown', word);
    assert.equal(token.glyph.length, 1, word);
    assert.ok(token.color in themeTokens, word);
    assert.ok(token.tint.includes(`var(--${token.color})`), word);
  }
});

for (const doc of ['README.md', 'docs/ui-web.md']) {
  test(`${doc} status table exactly matches every contract status and request-state glyph and label`, () => {
    const text = readFileSync(new URL(`../../../${doc}`, import.meta.url), 'utf8');
    const table = /\| Status \/ request state \| Glyph \| Label \|\r?\n\|[^\n]+\|\r?\n((?:\|[^\n]+\|\r?\n)+)/.exec(text);
    assert.ok(table, `${doc} must contain the Status / request state table`);
    const rows = table[1].trim().split('\n').map(line => {
      const [state, glyph, label] = line.split('|').slice(1, -1).map(cell => cell.trim().replace(/`/g, ''));
      return { state, glyph, label };
    });
    assert.deepEqual(rows, Object.entries(statusTaxonomy).map(([state, { glyph, label }]) => ({ state, glyph, label })));
  });
}

test('queued carries a distinct muted clock glyph', () => {
  const queued = statusToken('queued');
  assert.equal(queued.glyph, '◷');
  assert.equal(queued.color, 'muted');
  assert.equal(queued.label, 'Queued');
  for (const [word, token] of Object.entries(statusTaxonomy)) {
    if (word !== 'queued') assert.notEqual(queued.glyph, token.glyph, word);
  }
  assert.notEqual(queued.glyph, statusToken('nonsense').glyph);
});

test('stale carries an explicit neutral question mark', () => {
  assert.equal(statusToken('stale').glyph, '?');
  assert.equal(statusToken('stale').color, 'muted');
});

test('blocked and failed remain distinct without colour, as do possibly unseen and stale', () => {
  assert.equal(statusToken('blocked').glyph, '×');
  assert.equal(statusToken('failed').glyph, '#');
  assert.equal(statusToken('answer-possibly-unseen').glyph, '¿');
  assert.equal(statusToken('answer-possibly-unseen').label, 'Possibly unseen');
  assert.notEqual(statusToken('answer-possibly-unseen').glyph, statusToken('stale').glyph);
});

test('unknown status words fall back to a muted neutral token', () => {
  assert.deepEqual(statusToken('nonsense'), { glyph: '·', color: 'muted', label: 'Unknown', tint: 'color-mix(in srgb, var(--muted) 14%, transparent)' });
  assert.ok(Object.values(statusTaxonomy).every(token => token.glyph.length === 1));
});

test('high contrast overrides only known tokens and every colour is a 7-char hex', () => {
  assert.ok(Object.keys(highContrastOverrides).every(key => key in themeTokens));
  for (const colors of [themeColors(), themeColors(true)]) assert.ok(Object.values(colors).every(value => /^#[0-9a-f]{6}$/.test(value)));
  assert.equal(themeColors(true).text, '#ffffff');
  assert.equal(themeColors().text, themeTokens.text);
});
