import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monoOverrides } from '@pi-console/contract';
import { Settings } from '../shell/overlays.ts';
import { Screen, h, mountHeadless } from './renderer.ts';
import { palette, themeFromEnv } from './theme.ts';

test('a non-empty NO_COLOR forces plain; otherwise PI_CONSOLE_THEME, then the high-contrast switch', () => {
  assert.equal(themeFromEnv({}), 'midnight');
  assert.equal(themeFromEnv({ PI_CONSOLE_THEME: 'mono' }), 'mono');
  assert.equal(themeFromEnv({ PI_CONSOLE_THEME: 'sepia', PI_CONSOLE_HIGH_CONTRAST: '1' }), 'contrast');
  assert.equal(themeFromEnv({ NO_COLOR: '1' }), 'plain');
  assert.equal(themeFromEnv({ NO_COLOR: '1', PI_CONSOLE_THEME: 'contrast' }), 'plain');
  assert.equal(themeFromEnv({ NO_COLOR: '', PI_CONSOLE_THEME: 'contrast' }), 'contrast');
});

test('mono draws greys only and carries meaning by weight; Settings previews it', async () => {
  palette.configure('truecolor', 'mono');
  try {
    assert.equal(palette.resolve('red'), monoOverrides.red);
    assert.equal(palette.resolve('pressure:90'), monoOverrides.red);
    assert.ok(palette.emphasised('amber'));
    assert.ok(!palette.emphasised('muted'));
    const input = { endpoint: 'http://127.0.0.1:4777', connected: true, error: '', tokenSource: 'token file', lastSeq: 1, lastEventAt: 0, eventsReceived: 1, now: 0, counts: {} };
    const ui = await mountHeadless(h(Screen, {}, h(Settings, { input, width: 100, height: 40 })), { width: 100, height: 40 });
    try {
      await ui.settle();
      const frame = ui.frame();
      assert.match(frame, /Theme\s+mono\s+PI_CONSOLE_THEME=midnight\|contrast\|mono/);
      assert.match(frame, /! Needs you\s+\* Working/);
      assert.match(frame, /Text\s+Muted\s+Faint/);
    } finally { ui.destroy(); }
  } finally { palette.configure('truecolor', 'midnight'); }
});
