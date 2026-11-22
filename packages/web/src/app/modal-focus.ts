import { useLayoutEffect, useRef } from 'react';

const controls = 'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';

function tabbable(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(controls)].filter(element =>
    element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[hidden], [inert]')
    && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
}

/** Inert the siblings along the modal's ancestor path, never an ancestor of the dialog itself. */
function isolate(dialog: HTMLElement): () => void {
  const background = new Map<HTMLElement, boolean>();
  for (let branch = dialog; branch.parentElement; branch = branch.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
      background.set(sibling, sibling.inert);
      sibling.inert = true;
    }
  }
  return () => { for (const [element, inert] of background) element.inert = inert; };
}

/** Own focus for a mounted dialog, then restore the opener after releasing the background. */
export function activateModalFocus(dialog: HTMLElement): () => void {
  const document = dialog.ownerDocument;
  const opener = document.activeElement;
  const release = isolate(dialog);
  const focusFirst = (): void => { (tabbable(dialog)[0] ?? dialog).focus(); };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const items = tabbable(dialog);
    const index = items.findIndex(element => element === document.activeElement);
    const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index + 1) % items.length;
    (items[next] ?? dialog).focus();
  };
  const onFocus = (): void => { if (!dialog.contains(document.activeElement)) focusFirst(); };
  dialog.addEventListener('keydown', onKey);
  document.addEventListener('focusin', onFocus);
  focusFirst();
  return () => {
    dialog.removeEventListener('keydown', onKey);
    document.removeEventListener('focusin', onFocus);
    release();
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  };
}

/** Shared by the palette and help; layout timing captures the opener before setting initial focus. */
export function useModalFocus() {
  const dialog = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => dialog.current ? activateModalFocus(dialog.current) : undefined, []);
  return dialog;
}
