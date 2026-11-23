import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('./base.css', import.meta.url), 'utf8');
const rule = (selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `rule ${selector} is present`);
  return css.slice(start, css.indexOf('}', start));
};

test('the programmatically focused page heading has no ring while interactive focus-visible keeps its ring', () => {
  assert.match(rule("h1[tabindex='-1']:focus, h1[tabindex='-1']:focus-visible"), /box-shadow: none/);
  assert.match(rule(':focus-visible'), /box-shadow: var\(--focus\)/);
  assert.match(css, /forced-colors: active[\s\S]*:focus-visible \{ outline: 2px solid Highlight !important/);
  assert.match(css, /h1\[tabindex='-1'\]:focus-visible \{ outline: none !important/);
});

test('selects are themed from tokens with a custom caret, a focus ring and a forced-colors fallback', () => {
  const select = rule('select');
  assert.match(select, /appearance: none/);
  assert.match(select, /background-color: var\(--raised\)/);
  assert.match(select, /color: var\(--text\)/);
  assert.match(select, /border: 1px solid var\(--border\)/);
  assert.match(select, /currentColor/);
  assert.match(css, /input, select, textarea[^{]*\{ --border: var\(--border-strong\)/);
  assert.match(rule('select:focus-visible'), /var\(--focus\)/);
  assert.match(css, /forced-colors: active[\s\S]*select \{ appearance: auto; background-image: none/);
});
