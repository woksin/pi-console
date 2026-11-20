import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export interface Credentials { baseUrl: string; token: string; tokenSource: string }

export class CredentialError extends Error {}

/** The daemon token file is the only secret the TUI reads; anything other than owner-only access is refused. */
export function readTokenFile(path: string): string {
  const mode = statSync(path).mode;
  if (process.platform !== 'win32' && (mode & 0o077) !== 0) {
    throw new CredentialError(`Refusing to read ${path}: permissions ${(mode & 0o777).toString(8)} allow other users. Run: chmod 600 ${path}`);
  }
  return readFileSync(path, 'utf8').trim();
}

/** Resolution order: PI_CONSOLE_TOKEN, PI_CONSOLE_TOKEN_FILE, `<data dir>/token`. The URL is always loopback HTTP. */
export function resolveCredentials(env: NodeJS.ProcessEnv = process.env): Credentials {
  const baseUrl = env.PI_CONSOLE_URL ?? 'http://127.0.0.1:4777';
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new CredentialError('The TUI only talks to a loopback daemon over HTTP. Set PI_CONSOLE_URL to http://127.0.0.1:<port>.');
  }
  if (env.PI_CONSOLE_TOKEN) return { baseUrl, token: env.PI_CONSOLE_TOKEN.trim(), tokenSource: 'PI_CONSOLE_TOKEN' };
  const file = env.PI_CONSOLE_TOKEN_FILE ?? resolve(env.PI_CONSOLE_DATA_DIR ?? resolve(homedir(), '.pi-console'), 'token');
  try {
    return { baseUrl, token: readTokenFile(file), tokenSource: file };
  } catch (error) {
    if (error instanceof CredentialError) throw error;
    throw new CredentialError(`No daemon token at ${file}. Start the daemon first, or set PI_CONSOLE_TOKEN / PI_CONSOLE_TOKEN_FILE.`);
  }
}
