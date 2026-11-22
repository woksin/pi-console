import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { contextFor, isTyping, nativeActivation, resolveWebKey } from './keys.ts';
import { parseRoute } from './routes.ts';

function elementsFor(t: TestContext) {
  class Element extends EventTarget {
    readonly tagName: string;
    isContentEditable = false;
    readonly selector: string;
    readonly parent: Element | null;
    constructor(selector: string, parent: Element | null = null) { super(); this.selector = selector; this.parent = parent; this.tagName = selector.toUpperCase(); }
    closest(selectors: string): Element | null { return selectors.split(', ').includes(this.selector) ? this : this.parent?.closest(selectors) ?? null; }
  }
  class HtmlElement extends Element {}
  Object.defineProperty(globalThis, 'Element', { value: Element, configurable: true });
  Object.defineProperty(globalThis, 'HTMLElement', { value: HtmlElement, configurable: true });
  t.after(() => { Reflect.deleteProperty(globalThis, 'Element'); Reflect.deleteProperty(globalThis, 'HTMLElement'); });
  return { Element, HtmlElement };
}

test('interactive controls are not text entry and must not suppress Escape or navigation shortcuts', t => {
  const { Element, HtmlElement } = elementsFor(t);
  for (const selector of ['a', 'button', 'summary', '[role="button"]', '[role="link"]']) {
    const control = new HtmlElement(selector);
    assert.equal(isTyping(control), false, selector);
    assert.equal(isTyping(new HtmlElement('span', control)), false, `inside ${selector}`);
    assert.equal(isTyping(new Element('svg', control)), false, `SVG inside ${selector}`);
  }
  for (const selector of ['input', 'textarea', 'select']) assert.equal(isTyping(new HtmlElement(selector)), true, selector);
  const editable = new HtmlElement('span');
  editable.isContentEditable = true;
  assert.equal(isTyping(editable), true);
  assert.equal(isTyping(new Element('div')), false);
  assert.equal(isTyping(null), false);
  assert.equal(isTyping(new EventTarget()), false);
});

test('only Enter and Space defer to interactive controls and HTML or SVG descendants', t => {
  const { Element, HtmlElement } = elementsFor(t);
  for (const selector of ['a', 'button', 'select', 'summary', '[role="button"]', '[role="link"]']) {
    const control = new HtmlElement(selector);
    for (const key of ['Enter', 'Space', 'Esc', '?', 'j', '2', 'Ctrl+P']) {
      const activates = ['Enter', 'Space'].includes(key);
      assert.equal(nativeActivation(key, control), activates, `${selector}: ${key}`);
      assert.equal(nativeActivation(key, new HtmlElement('span', control)), activates, `inside ${selector}: ${key}`);
      assert.equal(nativeActivation(key, new Element('svg', control)), activates, `SVG inside ${selector}: ${key}`);
    }
  }
  assert.equal(nativeActivation('Enter', new HtmlElement('div')), false);
  assert.equal(nativeActivation('Space', null), false);
  assert.equal(nativeActivation('Enter', new EventTarget()), false);
});

test('the documented follow shortcut resolves in session detail even when a button owns focus', t => {
  const { HtmlElement } = elementsFor(t);
  const button = new HtmlElement('button');
  assert.equal(isTyping(button), false);
  assert.equal(nativeActivation('f', button), false);
  assert.equal(resolveWebKey('detail', 'f'), 'follow.toggle');
  assert.equal(resolveWebKey('detail', 'Enter'), undefined);
  assert.equal(nativeActivation('Enter', button), true);
  assert.equal(resolveWebKey('detail', 'Tab'), 'pane.next');
  assert.equal(resolveWebKey('help', 'f'), undefined);
  assert.equal(resolveWebKey('palette', 'f'), undefined);
  assert.equal(resolveWebKey('fleet', 'f'), undefined);
});

test('web list contexts follow the route; overlays and graph take precedence', () => {
  for (const view of ['overview', 'fleet', 'requests', 'questions', 'messages', 'work', 'timeline']) {
    const route = parseRoute(`#/${view}`);
    assert.equal(contextFor({ route, palette: false, help: false }), view);
    assert.equal(contextFor({ route, palette: true, help: true }), 'palette');
    assert.equal(contextFor({ route, palette: false, help: true }), 'help');
  }
  assert.equal(contextFor({ route: parseRoute('#/messages?view=graph'), palette: false, help: false }), 'graph');
  assert.equal(contextFor({ route: parseRoute('#/session/s2'), palette: false, help: false }), 'detail');
});
