import type { ScrollView } from './virtual-geometry.ts';

const focusable = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface BodyView extends ScrollView { container: HTMLElement; bodyTop: number }
export interface FocusRequest { index: number; edge: 'first' | 'last' }

/** The page scroll container's window over the table body, in body coordinates. */
export function bodyView(body: HTMLElement): BodyView {
  const container = body.closest<HTMLElement>('.content') ?? document.documentElement;
  const bodyTop = body.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
  const header = body.parentElement instanceof HTMLTableElement ? body.parentElement.tHead : null;
  return { container, bodyTop, scroll: container.scrollTop - bodyTop, viewport: container.clientHeight, inset: header?.offsetHeight ?? 0 };
}

/** Re-reads each row kind's height from a mounted representative; returns the same array when nothing changed. */
export function measuredHeights(body: HTMLElement, current: readonly number[]): readonly number[] {
  const next = [...current];
  let changed = false;
  for (const [kind, height] of current.entries()) {
    const measured = body.querySelector<HTMLElement>(`tr[data-vkind="${String(kind)}"]`)?.getBoundingClientRect().height;
    if (measured && Math.abs(measured - height) > 0.5) { next[kind] = measured; changed = true; }
  }
  return changed ? next : current;
}

export const rowOf = (target: EventTarget | null): HTMLElement | null => (target instanceof Element ? target.closest<HTMLElement>('tr[data-vindex]') : null);
const mountedRow = (body: ParentNode, index: number): HTMLElement | null => body.querySelector<HTMLElement>(`tr[data-vindex="${String(index)}"]`);

/** True when Tab in `direction` stays on another control of the same row. */
function staysInRow(row: HTMLElement, target: EventTarget | null, direction: 1 | -1): boolean {
  const controls = [...row.querySelectorAll<HTMLElement>(focusable)];
  const at = target instanceof Element ? controls.findIndex(control => control === target || control.contains(target)) : -1;
  return direction > 0 ? at >= 0 && at < controls.length - 1 : at > 0;
}

const plainTab = (event: React.KeyboardEvent<HTMLElement>): boolean => event.key === 'Tab' && !(event.altKey || event.ctrlKey || event.metaKey);

/** The adjacent logical row index a Tab leaves towards, or null when Tab stays within the row or leaves the table. */
function tabDestination(event: React.KeyboardEvent<HTMLElement>, count: number): number | null {
  const row = plainTab(event) ? rowOf(event.target) : null;
  if (!row) return null;
  const direction = event.shiftKey ? -1 : 1;
  const index = Number(row.dataset.vindex) + direction;
  return staysInRow(row, event.target, direction) || index < 0 || index >= count ? null : index;
}

/** The unmounted adjacent row a boundary Tab must reveal and focus, or null when the browser's own Tab order is right. */
export function boundaryTab(event: React.KeyboardEvent<HTMLElement>, count: number): FocusRequest | null {
  const index = tabDestination(event, count);
  if (index === null || mountedRow(event.currentTarget, index)) return null;
  return { index, edge: event.shiftKey ? 'last' : 'first' };
}

/** Focuses the requested row's first or last control once it is mounted; true when done. */
export function focusRequested(body: ParentNode, request: FocusRequest): boolean {
  const row = mountedRow(body, request.index);
  if (!row) return false;
  const controls = row.querySelectorAll<HTMLElement>(focusable);
  (request.edge === 'first' ? controls.item(0) : controls.item(controls.length - 1)).focus();
  return true;
}
