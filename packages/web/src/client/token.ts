const storageKey = 'pi-console.token';
const tabTokens = new WeakMap<TokenStorage, string | null>();

/** Tokens stay in this tab: session storage when available, memory otherwise. Never cookies or local storage. */
export interface TokenStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

/** Defer access: even reading the browser's sessionStorage property can throw. */
export const tabTokenStorage: TokenStorage = {
  getItem: key => sessionStorage.getItem(key),
  setItem: (key, value) => { sessionStorage.setItem(key, value); },
  removeItem: key => { sessionStorage.removeItem(key); },
};

const tokenPattern = /^[A-Za-z0-9._~-]{16,512}$/;

export const isPlausibleToken = (value: string): boolean => tokenPattern.test(value);

const fragmentToken = (hash: string): RegExpExecArray | null => /(?:^#|[&?])token=([^&]+)/.exec(hash);

/** Reads `#token=...` from the URL fragment (the launch link carries it there so it never reaches a server log). */
export function tokenFromFragment(hash: string): string | null {
  const match = fragmentToken(hash);
  if (!match) return null;
  try {
    const value = decodeURIComponent(match[1]);
    return isPlausibleToken(value) ? value : null;
  } catch { return null; }
}

function storedToken(storage: TokenStorage): string | null {
  if (tabTokens.has(storage)) return tabTokens.get(storage) ?? null;
  try {
    const token = storage.getItem(storageKey);
    tabTokens.set(storage, token);
    return token;
  } catch { return null; }
}

export function loadToken(storage: TokenStorage, hash: string): { token: string | null; cleanHash: string } {
  const fromFragment = tokenFromFragment(hash);
  const cleanHash = hash.replace(/([&?#])?token=[^&]+&?/, '$1').replace(/^#$/, '').replace(/[&?]$/, '');
  if (fromFragment) { saveToken(storage, fromFragment); return { token: fromFragment, cleanHash }; }
  return { token: fragmentToken(hash) ? null : storedToken(storage), cleanHash };
}

export function saveToken(storage: TokenStorage, token: string): void {
  tabTokens.set(storage, token);
  try { storage.setItem(storageKey, token); } catch { /* This tab retains its in-memory token. */ }
}

export function forgetToken(storage: TokenStorage): void {
  tabTokens.set(storage, null);
  try { storage.removeItem(storageKey); } catch { /* Rejected credentials stay cleared in this tab. */ }
}
