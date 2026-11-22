import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { activateModalFocus } from './modal-focus.ts';

/** Minimal DOM double; the browser specs exercise native focus and inert behavior. */
class FocusElement extends EventTarget {
  parentElement: FocusElement | null = null;
  children: FocusElement[] = [];
  inert = false;
  hidden = false;
  disabled = false;
  visibility = 'visible';
  isConnected = true;
  tabIndex = 0;
  control = false;
  readonly ownerDocument: FocusDocument;
  constructor(document: FocusDocument) { super(); this.ownerDocument = document; }
  append(...children: FocusElement[]): void {
    for (const child of children) { child.parentElement = this; this.children.push(child); }
  }
  querySelectorAll(): FocusElement[] { return this.children.flatMap(child => [...(child.control ? [child] : []), ...child.querySelectorAll()]); }
  matches(): boolean { return this.disabled; }
  closest(): FocusElement | null { return this.hidden || this.inert ? this : this.parentElement?.closest() ?? null; }
  getClientRects(): object[] { return this.hidden ? [] : [{}]; }
  contains(element: FocusElement | null): boolean { return element === this || this.children.some(child => child.contains(element)); }
  focus(): void { this.ownerDocument.activeElement = this; this.ownerDocument.dispatchEvent(new Event('focusin')); }
}

class FocusDocument extends EventTarget { activeElement: FocusElement | null = null; }

function modalFor(t: TestContext) {
  const document = new FocusDocument();
  const element = (control = false): FocusElement => { const result = new FocusElement(document); result.control = control; return result; };
  const body = element(), root = element(), app = element(), sidebar = element(), main = element(), overlay = element(), dialog = element();
  const first = element(true), last = element(true), opener = element(true), alreadyInert = element();
  body.append(root, alreadyInert); root.append(app); app.append(sidebar, main, overlay); overlay.append(dialog); dialog.append(first, last); main.append(opener);
  alreadyInert.inert = true;
  opener.focus();
  const saved = ['HTMLElement', 'getComputedStyle'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.defineProperty(globalThis, 'HTMLElement', { value: FocusElement, configurable: true });
  Object.defineProperty(globalThis, 'getComputedStyle', { value: (node: FocusElement) => ({ visibility: node.visibility }), configurable: true });
  t.after(() => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  const activate = (): (() => void) => activateModalFocus(dialog as unknown as HTMLElement);
  const tab = (shiftKey = false): Event => {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { key: 'Tab', shiftKey });
    dialog.dispatchEvent(event);
    return event;
  };
  return { document, dialog, first, last, opener, sidebar, main, root, alreadyInert, element, activate, tab };
}

test('modal focuses its first control and cycles Tab and Shift+Tab without escaping', t => {
  const modal = modalFor(t);
  const close = modal.activate();
  assert.equal(modal.document.activeElement, modal.first);
  assert.equal(modal.tab(true).defaultPrevented, true);
  assert.equal(modal.document.activeElement, modal.last);
  modal.tab(); assert.equal(modal.document.activeElement, modal.first);
  modal.tab(); assert.equal(modal.document.activeElement, modal.last);
  modal.tab(true); assert.equal(modal.document.activeElement, modal.first);
  close();
});

test('modal inerts only background branches and restores both their state and its opener on close', t => {
  const modal = modalFor(t);
  const close = modal.activate();
  assert.equal(modal.sidebar.inert, true);
  assert.equal(modal.main.inert, true);
  assert.equal(modal.root.inert, false);
  assert.equal(modal.dialog.inert, false);
  close();
  assert.equal(modal.sidebar.inert, false);
  assert.equal(modal.main.inert, false);
  assert.equal(modal.alreadyInert.inert, true);
  assert.equal(modal.document.activeElement, modal.opener);
  // StrictMode's setup/cleanup replay must retain the original opener.
  modal.activate()();
  assert.equal(modal.document.activeElement, modal.opener);
  modal.last.focus();
  assert.equal(modal.document.activeElement, modal.last, 'focus listener was removed');
});

test('modal contains programmatic focus and handles dynamically disabled or hidden controls', t => {
  const modal = modalFor(t);
  const close = modal.activate();
  modal.opener.focus(); assert.equal(modal.document.activeElement, modal.first);
  modal.last.disabled = true;
  modal.tab(); assert.equal(modal.document.activeElement, modal.first);
  modal.last.disabled = false; modal.last.hidden = true;
  modal.tab(true); assert.equal(modal.document.activeElement, modal.first);
  modal.last.hidden = false; modal.last.visibility = 'hidden';
  modal.tab(); assert.equal(modal.document.activeElement, modal.first);
  modal.last.visibility = 'visible'; modal.last.tabIndex = -1;
  modal.tab(); assert.equal(modal.document.activeElement, modal.first);
  const added = modal.element(true); modal.dialog.append(added);
  modal.tab(); assert.equal(modal.document.activeElement, added);
  close();
});

test('a modal without tabbable controls keeps focus on its dialog and tolerates a removed opener', t => {
  const modal = modalFor(t);
  modal.dialog.children = [];
  const close = modal.activate();
  assert.equal(modal.document.activeElement, modal.dialog);
  modal.tab(); modal.tab(true);
  assert.equal(modal.document.activeElement, modal.dialog);
  modal.opener.isConnected = false;
  close();
  assert.equal(modal.document.activeElement, modal.dialog);
});
