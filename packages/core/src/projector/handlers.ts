import type { EventEnvelope, EventPayloads } from '@pi-console/contract';
import type { DirtyReporter, Projection } from './projection.ts';
import { safeRecords } from './records.ts';

type EventType = keyof EventPayloads;

/** One handler per event type; it mutates the projection-owned state. Pure apart from that. */
export type Handlers<State> = {
  [Type in EventType]?: (state: State, payload: EventPayloads[Type], event: EventEnvelope) => void;
};

const reporters = new WeakMap<object, DirtyReporter>();

/** Mutation sites explicitly report touched row ids, including ids about to be deleted. */
export function markDirty(state: object, collection: string, id: string): void {
  reporters.get(state)?.(collection, id);
}

/** Builds a projection that dispatches each event to the handler for its type and ignores the rest. */
export function projection<State>(name: string, version: number, initial: () => State, handlers: Handlers<State>, collections?: readonly string[]): Projection<State> {
  return {
    name, version, initial: () => safeRecords(initial()),
    ...(collections ? { collections } : {}),
    apply(state, event, dirty) {
      const handler = (Object.hasOwn(handlers, event.type) ? handlers[event.type as EventType] : undefined) as ((state: State, payload: unknown, event: EventEnvelope) => void) | undefined;
      if (dirty) reporters.set(state as object, dirty);
      try { handler?.(state, event.payload, event); }
      finally { reporters.delete(state as object); }
      return state;
    },
  };
}

/** Total order of events by when they happened: occurredAt, ties broken by id. Independent of arrival order. */
export const orderKey = (event: EventEnvelope): string => `${event.occurredAt}|${event.id}`;

/** Inserts after every item whose key is <= the new item's key, so late arrivals land in occurredAt order. */
export function insertSorted<Item>(items: Item[], item: Item, key: (item: Item) => string): void {
  const index = items.findIndex(existing => key(existing) > key(item));
  items.splice(index < 0 ? items.length : index, 0, item);
}

/** Gets or creates the entry for `id` in a record-shaped state. */
export function entry<Item>(items: Record<string, Item>, id: string, create: () => Item): Item {
  if (!Object.hasOwn(items, id)) Object.defineProperty(items, id, { value: create(), writable: true, enumerable: true, configurable: true });
  return items[id];
}
