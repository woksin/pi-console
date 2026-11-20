import { useEffect, useRef } from 'react';
import type { Command } from '@pi-console/viewmodels';

/** A handler returns true when it consumed the command. Later registrations (views, dialogs) run first. */
export type CommandHandler = (command: Command) => boolean;

const handlers: CommandHandler[] = [];

export function dispatch(command: Command): boolean {
  for (let index = handlers.length - 1; index >= 0; index--) if (handlers[index](command)) return true;
  return false;
}

export function useCommands(handler: CommandHandler, enabled = true): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!enabled) return undefined;
    const wrapper: CommandHandler = command => latest.current(command);
    handlers.push(wrapper);
    return () => { handlers.splice(handlers.indexOf(wrapper), 1); };
  }, [enabled]);
}
