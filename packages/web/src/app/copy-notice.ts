/** The short, polite "Copied" / failure notice shown after a copy shortcut; one at a time, cleared after a few seconds. */
const listeners = new Set<() => void>();
let current: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export const noticeMillis = 3000;

function show(message: string | null): void {
  current = message;
  for (const listener of listeners) listener();
}

/** True when the write succeeded; a missing clipboard (non-secure context) or a rejected write is a failure, never a throw. */
async function write(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** Writes to the clipboard and announces the outcome. Falls back to a failure notice where the API is unavailable. */
export async function copyWithNotice(text: string, label: string): Promise<boolean> {
  const copied = await write(text);
  clearTimeout(timer);
  show(copied ? `Copied ${label}` : `Could not copy ${label}: clipboard unavailable`);
  timer = setTimeout(() => { show(null); }, noticeMillis);
  return copied;
}

export const currentNotice = (): string | null => current;

export const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Clears a pending expiry; for unmount. */
export const cancelExpiry = (): void => { clearTimeout(timer); };
