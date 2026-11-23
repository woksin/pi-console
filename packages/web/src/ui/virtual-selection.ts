import { useEffect, useMemo, useRef } from 'react';
import { useListNav, type ListNav } from '../app/hooks.ts';
import type { VirtualTable } from './virtual-table.tsx';

/**
 * Keyboard selection over the whole logical row list of a virtual table: moves reveal the target before its row mounts, and
 * a change of `trigger` (a new filter or collapsed set) reconciles scroll to the surviving selection. Live data updates and
 * manual scrolling never snap back to it.
 */
export function useVirtualSelection(keys: readonly string[], table: Pick<VirtualTable, 'scrollToIndex'>, options: { trigger: unknown; fallback?: string | null; onOpen: (key: string) => void }): { nav: ListNav; indexOfKey: ReadonlyMap<string, number> } {
  const indexOfKey = useMemo(() => new Map(keys.map((key, index) => [key, index])), [keys]);
  const nav = useListNav(keys, { fallback: options.fallback, onOpen: options.onOpen, onMove: key => { table.scrollToIndex(indexOfKey.get(key) ?? 0); } });
  const reveal = useRef<() => void>(() => undefined);
  reveal.current = () => { const index = nav.selected === null ? undefined : indexOfKey.get(nav.selected); if (index !== undefined) table.scrollToIndex(index); };
  useEffect(() => { reveal.current(); }, [options.trigger]);
  return { nav, indexOfKey };
}
