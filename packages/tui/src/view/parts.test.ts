import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayWidth } from '@pi-console/viewmodels';
import { fit, rule, split, statusParts, t } from './parts.ts';
import type { Line } from './renderer.ts';

const textOf = (line: Line): string => line.map(part => part.text).join('');

test('fit uses terminal widths, preserves styles and pads a wide glyph at the clipping edge', () => {
  const line = fit([t('e\u0301 ', 'blue'), t('界😀x', 'pink')], 6, 'select');
  assert.equal(textOf(line), 'e\u0301 界 …');
  assert.equal(displayWidth(textOf(line)), 6);
  assert.equal(line[0]?.color, 'blue');
  assert.equal(line[1]?.color, 'pink');
  assert.ok(line.every(part => part.background === 'select'));
  assert.equal(textOf(fit([t('界')], 4)), '界  ');
});

test('fit retains the existing ASCII cut-part ellipsis and whitespace behavior', () => {
  assert.equal(textOf(fit([t('abc'), t('  defghi')], 8)), 'abc def…');
  assert.equal(textOf(fit([t('ab'), t('cd')], 2)), 'ab');
});

test('fit keeps a grapheme intact even when styles divide its code points', () => {
  const accent = [t('e', 'blue'), t('\u0301', 'pink')];
  assert.equal(textOf(fit(accent, 1)), 'e\u0301');
  const joined = [t('👩', 'blue'), t('\u200d💻', 'pink')];
  assert.equal(textOf(fit(joined, 2)), '👩‍💻');
  assert.equal(textOf(fit([...joined, t('x')], 2)), ' …');
  assert.equal(textOf(fit([t('🇳🇴x')], 2)), ' …');
});

test('split and rules budget their Unicode labels in cells', () => {
  const line = split([t('界界界')], [t('🇳🇴')], 8);
  assert.equal(displayWidth(textOf(line)), 8);
  assert.ok(textOf(line).endsWith(' 🇳🇴'));
  assert.equal(displayWidth(textOf(rule(12, '界😀'))), 12);
});

test('status parts show the contract glyph at rest and animate only when given a phase', () => {
  const working = { status: 'working', glyph: '*', label: 'Working', color: 'green' } as Parameters<typeof statusParts>[0];
  assert.equal(statusParts(working, undefined, false)[0]?.text, '*');
  assert.notEqual(statusParts(working, 3, false)[0]?.text, '*');
});
