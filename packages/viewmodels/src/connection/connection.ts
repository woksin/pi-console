/** Shared reconnect wording, based on when data was last received, not when it was rendered. */
export function connectionBanner(connection: { connected: boolean; lastEventAt: number | undefined }): string | undefined {
  if (connection.connected) return undefined;
  const data = connection.lastEventAt === undefined
    ? 'waiting for data'
    : `showing data as of ${new Date(connection.lastEventAt).toISOString().slice(11, 19)} UTC`;
  return `Daemon unreachable · ${data} · retrying`;
}
