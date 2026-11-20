const storageKey = 'pi-console.token';

/** Where the token lives: this tab's session storage only. Never a cookie, never local storage, never logged. */
export interface TokenStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

const tokenPattern = /^[A-Za-z0-9._~-]{16,512}$/;

export const isPlausibleToken = (value: string): boolean => tokenPattern.test(value);

/** Reads `#token=...` from the URL fragment (the launch link carries it there so it never reaches a server log). */
export function tokenFromFragment(hash: string): string | null {
  const match = /(?:^#|[&?])token=([^&]+)/.exec(hash);
  if (!match) return null;
  const value = decodeURIComponent(match[1]);
  return isPlausibleToken(value) ? value : null;
}

export function loadToken(storage: TokenStorage, hash: string): { token: string | null; cleanHash: string } {
  const fromFragment = tokenFromFragment(hash);
  const cleanHash = hash.replace(/([&?#])?token=[^&]+&?/, '$1').replace(/^#$/, '').replace(/[&?]$/, '');
  if (fromFragment) { storage.setItem(storageKey, fromFragment); return { token: fromFragment, cleanHash }; }
  return { token: storage.getItem(storageKey), cleanHash };
}

export const saveToken = (storage: TokenStorage, token: string): void => { storage.setItem(storageKey, token); };
export const forgetToken = (storage: TokenStorage): void => { storage.removeItem(storageKey); };
