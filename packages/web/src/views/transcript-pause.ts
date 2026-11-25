import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useActions } from '../app/commands.ts';
import { isTyping } from '../app/keys.ts';

const pausingKeys = ['PageUp', 'ArrowUp', 'Home', 'k', 'g'];

/** Reading back up is a deliberate act: a user scroll away from the tail pauses following. */
export function usePauseOnUserScroll(pause: () => void): void {
  useEffect(() => {
    const onWheel = (event: WheelEvent): void => { if (event.deltaY < 0) pause(); };
    const onKey = (event: KeyboardEvent): void => { if (!isTyping(event.target) && pausingKeys.includes(event.key)) pause(); };
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchmove', pause, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('wheel', onWheel); window.removeEventListener('touchmove', pause); window.removeEventListener('keydown', onKey); };
  }, [pause]);
}

/** `following` mirrors `follow` synchronously, so observers can stop acting the moment a user pauses, before React re-renders. */
export interface Follow { follow: boolean; following: RefObject<boolean>; pause: () => void; toggleFollow: () => void }

/** Follow-the-tail state: toggled by the follow action, paused by any user scroll away from the tail. */
export function useFollow(initial: boolean, onResume: () => void, onFollow: (following: boolean) => void): Follow {
  const [follow, setFollow] = useState(initial);
  const following = useRef(initial);
  const pause = useCallback((): void => { following.current = false; setFollow(false); onFollow(false); }, [onFollow]);
  const toggleFollow = useCallback((): void => { if (!follow) onResume(); following.current = !follow; setFollow(!follow); onFollow(!follow); }, [follow, onResume, onFollow]);
  useActions(action => { if (action !== 'follow.toggle') return false; toggleFollow(); return true; });
  usePauseOnUserScroll(pause);
  return { follow, following, pause, toggleFollow };
}
