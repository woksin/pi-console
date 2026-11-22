import { cells, clip } from '../format/format.ts';

/** The error the TUI client reports for an HTTP 401; the banner turns it into a fix instruction. */
export const tokenRejectedError = 'Token rejected (HTTP 401)';

/** The placeholder state before the first connection attempt reports anything; it is not an error to show. */
export const connectingState = 'Connecting…';

const lead = 'Daemon unreachable';
const trail = 'retrying';
const minErrorCells = 8;

export interface ConnectionBannerInput { connected: boolean; lastEventAt: number | undefined; error?: string }

/** The error replaces the as-of time when both do not fit in `maxCells`; the error is dropped only when even a clipped one does not fit. */
function withError(data: string, error: string, maxCells: number): string {
  const full = `${lead} · ${data} · ${error} · ${trail}`;
  if (cells(full).length <= maxCells) return full;
  const room = maxCells - cells(`${lead} ·  · ${trail}`).length;
  return room >= minErrorCells ? `${lead} · ${clip(error, room)} · ${trail}` : `${lead} · ${data} · ${trail}`;
}

/**
 * Shared reconnect wording, based on when data was last received, not when it was rendered. Shows the last error when there is one,
 * within `maxCells` (a rejected token gets its own instruction instead).
 */
export function connectionBanner(connection: ConnectionBannerInput, maxCells = Infinity): string | undefined {
  if (connection.connected) return undefined;
  if (connection.error === tokenRejectedError) return 'Token rejected · check PI_CONSOLE_TOKEN or --data-dir · retrying';
  const data = connection.lastEventAt === undefined
    ? 'waiting for data'
    : `showing data as of ${new Date(connection.lastEventAt).toISOString().slice(11, 19)} UTC`;
  return connection.error && connection.error !== connectingState ? withError(data, connection.error, maxCells) : `${lead} · ${data} · ${trail}`;
}
