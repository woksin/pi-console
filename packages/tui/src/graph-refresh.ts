import type { Event, Graph } from '@pi-console/contract';
import type { DaemonClient } from './api/client.ts';
import { throttled } from './refresh.ts';

/** The graph is a canonical query, not a projection of the TUI's loaded message page. */
export function graphRefresher(client: Pick<DaemonClient, 'graph'>, publish: (graph: Graph) => void) {
  let stopped = false;
  const refresh = throttled(async () => {
    const graph = await client.graph();
    if (!stopped) publish(graph);
  }, 2000);
  return {
    request(type?: Event['type']): void {
      if (type === undefined || ['snapshot', 'message.sent', 'session.updated'].includes(type)) refresh.request();
    },
    stop(): void { stopped = true; refresh.stop(); },
  };
}
