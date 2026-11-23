import type { Segment } from './virtual-geometry.ts';

export interface VirtualTable {
  /** Spread onto the `<tbody>`: tracks the scroll container, the focused row and boundary Tab navigation. */
  bodyProps: { ref: (element: HTMLTableSectionElement | null) => void; onFocus: (event: React.FocusEvent<HTMLElement>) => void; onBlur: (event: React.FocusEvent<HTMLElement>) => void; onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void };
  /** Mounted rows and the `aria-hidden` spacers standing in for the rest, in document order. */
  segments: readonly Segment[];
  /** Total logical rows, for `aria-rowcount` (add one for the header). */
  count: number;
  /** Attributes every mounted row carries: its logical index and kind, and its `aria-rowindex` (the header is row 1). */
  rowAttributes: (index: number) => { 'data-vindex': number; 'data-vkind': number; 'data-vkey': string; 'aria-rowindex': number };
  /** Reveals a logical row, mounted or not, with the least scrolling. */
  scrollToIndex: (index: number) => void;
}

export type VirtualRowAttributes = ReturnType<VirtualTable['rowAttributes']>;
