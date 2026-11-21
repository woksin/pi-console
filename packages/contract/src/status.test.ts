import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionStatuses, statusTaxonomy, statusToken } from './status.ts';
import { highContrastOverrides, themeColors, themeTokens } from './theme.ts';
import { apiV0Schema } from './api.ts';

test('every v0 session status and request/job status word has a glyph, label and a real theme colour', () => {
  const session = (apiV0Schema.$defs.session as { properties: { status: { enum: string[] } } }).properties.status.enum;
  assert.deepEqual([...sessionStatuses], session);
  for (const word of [...session, 'running', 'interrupted', 'answered', 'unanswered', 'open', 'answer-possibly-unseen']) {
    const token = statusToken(word);
    assert.notEqual(token.label, 'Unknown', word);
    assert.equal(token.glyph.length, 1, word);
    assert.ok(token.color in themeTokens, word);
    assert.ok(token.tint.includes(`var(--${token.color})`), word);
  }
});

test('stale carries an explicit neutral question mark', () => {
  assert.equal(statusToken('stale').glyph, '?');
  assert.equal(statusToken('stale').color, 'muted');
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
