import { useEffect, useState } from 'react';
import { FLASH_MS, FlashTracker, LookTracker, newSince, type NewSince } from '@pi-console/viewmodels';

/** One per page: what the Overview showed when the user last left it, and which attention rows flashed when. */
const look = new LookTracker();
const flashes = new FlashTracker();

/** "N new since you looked" for the shown cards; leaving the Overview marks them seen. Nothing is new before the data loads. */
export function useNewSince(ids: readonly string[], loaded: boolean): NewSince {
  useEffect(() => () => { look.leave(); }, []);
  return loaded ? look.look(ids) : newSince(null, ids);
}

/** True for `FLASH_MS` after this row's status changes, at most once per row per cooldown; base.css stops the animation under reduced motion. */
export function useStatusFlash(id: string, status: string): boolean {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!flashes.observe([{ id, status }], Date.now())) return undefined;
    setFlash(true);
    const timer = window.setTimeout(() => { setFlash(false); }, FLASH_MS);
    return () => { window.clearTimeout(timer); };
  }, [id, status]);
  return flash;
}
