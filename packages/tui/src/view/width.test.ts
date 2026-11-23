import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pad, wrap } from '@pi-console/viewmodels';
import { fit, split, t } from './parts.ts';
import { h, Lines, mountHeadless, Screen, textWidth, useTextWidth } from './renderer.ts';

const family = '👨‍👩‍👧‍👦';

function Wrapped(props: { text: string; width: number }) {
  const measure = useTextWidth();
  return h(Screen, {}, h(Lines, { lines: wrap(props.text, props.width, Infinity, measure).map(text => [t(text)]) }));
}

for (const width of [40, 60]) {
  test(`joined emoji never loses trailing text when rendered at ${String(width)} columns`, async () => {
    const count = width - 7;
    const screen = await mountHeadless(h(Wrapped, { text: `${family} ${'x'.repeat(count)}`, width }), { width, height: 6 });
    try {
      await screen.settle();
      const frame = screen.frame();
      assert.equal((frame.match(/x/g) ?? []).length, count, frame);
      assert.ok(frame.includes(family), frame);
    } finally { screen.destroy(); }
  });
}

function Fitted({ width }: { width: number }) {
  const measure = useTextWidth();
  const joined = [t('👨‍', 'cyan'), t('👩‍👧‍👦', 'pink')];
  return h(Screen, {}, h(Lines, { lines: [
    fit([...joined, t('abc')], width, undefined, measure),
    [t(pad(family, width - 1, measure)), t('|')],
    split([t(family)], [t('END')], width, { measure }),
    ...wrap('👍🏽 界界 é ' + 'x'.repeat(10), width, Infinity, measure).map(text => [t(text)]),
  ] }));
}

test('rendered padding, clipped styled graphemes, skin tones and CJK use the same cell budget', async () => {
  const width = textWidth('wcwidth')(family) + 2;
  const screen = await mountHeadless(h(Fitted, { width }), { width, height: 12 });
  try {
    await screen.settle();
    const frame = screen.frame();
    assert.ok(frame.includes(`${family}a…`), frame);
    assert.ok(frame.includes(`${family} |`), frame);
    assert.ok(frame.includes('END'), frame);
    assert.ok(frame.includes('👍🏽'), frame);
    assert.ok(frame.includes('界界'), frame);
    assert.ok(frame.includes('é'), frame);
    assert.equal((frame.match(/x/g) ?? []).length, 10, frame);
  } finally { screen.destroy(); }
});

test('the adapter measures both OpenTUI width methods without changing shared defaults', () => {
  const fallback = textWidth('wcwidth');
  assert.ok(fallback(family) > 2);
  assert.equal(textWidth('unicode')(family), 2);
  assert.deepEqual(wrap(`${family} abc`, fallback(family) + 1, Infinity, fallback), [family, 'abc']);
  assert.deepEqual(wrap(`${family} abc`, 6, Infinity, textWidth('unicode')), [`${family} abc`]);
  assert.deepEqual(wrap(`${family} abc`, 6), [`${family} abc`]);
});
