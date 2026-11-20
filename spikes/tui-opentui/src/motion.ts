import { useEffect, useState } from 'react';
import { useRenderer } from '@opentui/react';
import { createTimeline, getTimelineEngine } from '@opentui/core';

// Renderer-owned clocks are released on unmount, including in native tests.
export function useMotion(identity: unknown, duration = 500, loop = false) {
  const renderer = useRenderer();
  const [value, setValue] = useState(0);
  useEffect(() => {
    const target = { value: 0 };
    setValue(0);
    const timeline = createTimeline({ duration, loop, frameRate: 20, autoplay: false }, renderer);
    timeline.add(target, { value: 1, duration, ease: loop ? 'linear' : 'outElastic', onUpdate: () => setValue(target.value) });
    timeline.play();
    return () => { timeline.pause(); getTimelineEngine(renderer).unregister(timeline); };
  }, [identity, duration, loop, renderer]);
  return value;
}
export function blend(a: string, b: string, amount: number) {
  const t = Math.max(0, Math.min(1, amount));
  return '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
}
