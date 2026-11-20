import { testEvent } from '@pi-console/core/testing';
import { daemonConformance } from '@pi-console/testkit';
import { publishedAfter, seedEvents, sessionStarted, specDaemon } from './testing/harness.ts';

let next = 2_000_000;

function requestEvent(open: boolean, sessionId: string) {
  if (open) return testEvent(next++, 'RequestObserved', { requestId: 'conformance-request', sessionId, origin: 'launch', originEvidence: 'spec' });
  return testEvent(next++, 'AnswerObserved', { requestId: 'conformance-request', answerId: 'conformance-answer', interim: false });
}

function questionEvent(open: boolean, sessionId: string) {
  if (open) return testEvent(next++, 'QuestionAsked', { questionId: 'conformance-question', asker: sessionId, kind: 'question', urgency: 'normal', blocking: true });
  return testEvent(next++, 'QuestionAnswered', { questionId: 'conformance-question' });
}

daemonConformance('real daemon', {
  async start({ replayWindow }) {
    const attentionSessionId = 'conformance-attention';
    const spec = await specDaemon([...seedEvents(), sessionStarted(next++, attentionSessionId)], { replayWindow });
    const { daemon } = spec;
    return {
      port: daemon.port, address: daemon.address, token: spec.token,
      async emit() {
        const seq = daemon.stream.seq;
        await daemon.log.append([testEvent(next++, 'SessionHeartbeat', { sessionId: 's1' })]);
        await publishedAfter(daemon, seq);
      },
      attentionSessionId,
      async emitAttention(kind, open) {
        const seq = daemon.stream.seq;
        const event = kind === 'request' ? requestEvent(open, attentionSessionId) : questionEvent(open, attentionSessionId);
        await daemon.log.append([event]);
        await publishedAfter(daemon, seq);
      },
      close: () => spec.close(),
    };
  },
});
