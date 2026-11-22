import { useEffect, useSyncExternalStore } from 'react';
import { cancelExpiry, currentNotice, subscribe } from './copy-notice.ts';

export function CopyNotice() {
  const message = useSyncExternalStore(subscribe, currentNotice);
  useEffect(() => cancelExpiry, []);
  return <div className="copy-notice" role="status" aria-live="polite" data-testid="copy-notice">{message}</div>;
}
