import { defaultDataDir, readDaemonPort } from '@pi-console/contract/daemon-config';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Credentials { baseUrl: string; token: string; tokenSource: string }

export class CredentialError extends Error {}

/** A token is visible ASCII; anything else (a stray newline, a control character) would make the HTTP client throw an error that echoes it. */
function checked(credentials: Credentials): Credentials {
  if (/[^\x21-\x7e]/u.test(credentials.token)) {
    throw new CredentialError(`The daemon token from ${credentials.tokenSource} contains a space, control or non-ASCII character. Check it for stray lines or characters.`);
  }
  return credentials;
}

/** The daemon token file is the only secret the TUI reads; anything other than owner-only access is refused. */
export function readTokenFile(path: string): string {
  const mode = statSync(path).mode;
  if (process.platform !== 'win32' && (mode & 0o077) !== 0) {
    throw new CredentialError(`Refusing to read ${path}: permissions ${(mode & 0o777).toString(8)} allow other users. Run: chmod 600 ${path}`);
  }
  return readFileSync(path, 'utf8').trim();
}

function daemonOrigin(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new CredentialError('The TUI only talks to a loopback daemon over HTTP. Set PI_CONSOLE_URL to http://127.0.0.1:<port>.');
  }
  const unsupported = ([
    ['path', url.pathname !== '/'],
    ['query', url.href.replace(/#.*$/u, '').includes('?')],
    ['fragment', url.href.includes('#')],
    ['username', Boolean(url.username)],
    ['password', Boolean(url.password)],
  ] as const).find(([, present]) => present);
  if (unsupported) {
    throw new CredentialError(`PI_CONSOLE_URL has an unsupported ${unsupported[0]}. Set PI_CONSOLE_URL to http://127.0.0.1:<port> (origin only).`);
  }
  return url.origin;
}

/** Resolution order: PI_CONSOLE_TOKEN, PI_CONSOLE_TOKEN_FILE, `<data dir>/token`. The URL is always loopback HTTP. */
export function resolveCredentials(env: NodeJS.ProcessEnv = process.env): Credentials {
  const dataDir = resolve(env.PI_CONSOLE_DATA_DIR ?? defaultDataDir());
  const baseUrl = daemonOrigin(env.PI_CONSOLE_URL ?? `http://127.0.0.1:${String(readDaemonPort(dataDir))}`);
  if (env.PI_CONSOLE_TOKEN) return checked({ baseUrl, token: env.PI_CONSOLE_TOKEN.trim(), tokenSource: 'PI_CONSOLE_TOKEN' });
  const file = env.PI_CONSOLE_TOKEN_FILE ?? resolve(dataDir, 'token');
  try {
    return checked({ baseUrl, token: readTokenFile(file), tokenSource: file });
  } catch (error) {
    if (error instanceof CredentialError) throw error;
    throw new CredentialError(`No daemon token at ${file}. Start the daemon first, or set PI_CONSOLE_TOKEN / PI_CONSOLE_TOKEN_FILE.`);
  }
}
