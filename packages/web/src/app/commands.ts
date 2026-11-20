import { useEffect, useRef } from 'react';
import type { Action } from '@pi-console/viewmodels';

/** A handler returns true when it consumed the action. Later registrations run first (parents register after children). */
export type ActionHandler = (action: Action) => boolean;

const handlers: ActionHandler[] = [];

export function dispatch(action: Action): boolean {
  for (let index = handlers.length - 1; index >= 0; index--) if (handlers[index](action)) return true;
  return false;
}

export function useActions(handler: ActionHandler, enabled = true): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!enabled) return undefined;
    const wrapper: ActionHandler = action => latest.current(action);
    handlers.push(wrapper);
    return () => { handlers.splice(handlers.indexOf(wrapper), 1); };
  }, [enabled]);
}
