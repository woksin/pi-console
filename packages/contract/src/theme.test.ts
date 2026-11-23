import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accentTokens, dawnOverrides, monoOverrides, themeColors, themeTokens } from './theme.ts';

const luminance = (hex: string): number => {
  const linear = [1, 3, 5].map(offset => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
};
const contrast = (a: string, b: string): number => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
const grey = (hex: string): boolean => hex.slice(1, 3) === hex.slice(3, 5) && hex.slice(3, 5) === hex.slice(5, 7);

test('mono is greys only and every foreground meets AA on every surface, including the selection', () => {
  assert.ok(Object.values(monoOverrides).every(grey));
  for (const foreground of ['text', 'muted', 'faint', ...accentTokens] as const) {
    for (const surface of ['bg', 'panel', 'raised', 'select', 'flash'] as const) {
      assert.ok(contrast(monoOverrides[foreground], monoOverrides[surface]) >= 4.5, `${foreground} on ${surface}`);
    }
  }
  assert.ok(contrast(monoOverrides['hot-text'], monoOverrides.amber) >= 4.5, 'hot badge text');
});

const themes = {
  midnight: themeColors(),
  contrast: themeColors(true),
  dawn: { ...themeTokens, ...dawnOverrides },
  mono: monoOverrides,
} as const;

for (const [name, colors] of Object.entries(themes)) {
  test(`${name}: every text tone and status colour meets AA 4.5:1 on bg, panel, raised, select and flash`, () => {
    for (const foreground of ['text', 'muted', 'faint', ...accentTokens] as const) {
      for (const surface of ['bg', 'panel', 'raised', 'select', 'flash'] as const) {
        const ratio = contrast(colors[foreground], colors[surface]);
        assert.ok(ratio >= 4.5, `${name}: ${foreground} on ${surface} is ${ratio.toFixed(2)}:1`);
      }
    }
  });
}
