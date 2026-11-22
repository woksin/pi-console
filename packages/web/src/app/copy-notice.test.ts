import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { copyWithNotice, currentNotice } from './copy-notice.ts';

function clipboard(t: TestContext, writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText } }, configurable: true });
  t.after(() => { Reflect.deleteProperty(globalThis, 'navigator'); });
}

test('copying writes the exact text and announces Copied', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const written: string[] = [];
  clipboard(t, text => { written.push(text); return Promise.resolve(); });
  assert.equal(await copyWithNotice('session-42', 'session id'), true);
  assert.deepEqual(written, ['session-42']);
  assert.equal(currentNotice(), 'Copied session id');
  t.mock.timers.tick(3000);
  assert.equal(currentNotice(), null);
});

test('an unavailable clipboard reports failure instead of claiming success', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  clipboard(t, () => Promise.reject(new Error('denied')));
  assert.equal(await copyWithNotice('abc', 'id'), false);
  assert.match(currentNotice() ?? '', /clipboard unavailable/);
  t.mock.timers.tick(3000);
});
