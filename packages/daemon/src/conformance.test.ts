import { testEvent } from '@pi-console/core/testing';
import { daemonConformance } from '@pi-console/testkit';
import { publishedAfter, specDaemon } from './testing/harness.ts';

let next = 2_000_000;

daemonConformance('real daemon', {
  async start({ replayWindow }) {
    const spec = await specDaemon(undefined, { replayWindow });
    const { daemon } = spec;
    return {
      port: daemon.port, address: daemon.address, token: spec.token,
      async emit() {
        const seq = daemon.stream.seq;
        await daemon.log.append([testEvent(next++, 'SessionHeartbeat', { sessionId: 's1' })]);
        await publishedAfter(daemon, seq);
      },
      close: () => spec.close(),
    };
  },
});
