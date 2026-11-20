
import { useCommands } from './commands.ts';

/** Binds the `/` key to focusing a view's search box. */
export function useViewFocus(ref: React.RefObject<HTMLInputElement | null>): void {
  useCommands(command => {
    if (command.type !== 'filter') return false;
    ref.current?.focus();
    ref.current?.select();
    return true;
  });
}
