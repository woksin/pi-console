import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorsFor, themeIds } from './theme.ts';

const luminance = (hex: string): number => {
  const linear = [1, 3, 5].map(offset => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
};
const contrast = (a: string, b: string): number => {
  const values = [luminance(a), luminance(b)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
};

for (const theme of themeIds) {
  test(`${theme}: small text, input boundaries and hot badges meet AA`, () => {
    const colors = colorsFor(theme);
    for (const surface of ['bg', 'panel'] as const) assert.ok(contrast(colors.faint, colors[surface]) >= 4.5, `faint on ${surface}`);
    for (const surface of ['bg', 'panel', 'raised'] as const) assert.ok(contrast(colors['border-strong'], colors[surface]) >= 3, `input border on ${surface}`);
    assert.ok(contrast(colors['hot-text'], colors.amber) >= 4.5, 'hot badge text');
  });
}
