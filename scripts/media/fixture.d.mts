import type { MemoryItem } from '@pi-console/contract';

export const memoryClock: string;
export function decorateMemory(memory: MemoryItem[]): void;
export function showcaseMemory(source: readonly MemoryItem[], now: string): MemoryItem[];
export function prepareShowcase(fixture: unknown, memory: MemoryItem[]): void;
export function rebase<T>(value: T, offset: number): T;
