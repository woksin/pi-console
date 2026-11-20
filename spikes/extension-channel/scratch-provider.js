import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

// Deterministic, offline fixture: no HTTP, credentials, tools, or model calls.
export default async function fixtureProvider(pi) {
  if (process.env.PI_CONSOLE_SCRATCH_CWD !== process.cwd()) return;
  const modulePath = join(process.env.PI_CONSOLE_PI_DIR, 'node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js');
  const { createAssistantMessageEventStream } = await import(pathToFileURL(modulePath).href);
  pi.registerProvider('console-fixture', {
    baseUrl: 'http://127.0.0.1:1', api: 'openai-completions', apiKey: 'offline-fixture',
    models: [{ id: 'fixture', name: 'Offline fixture', reasoning: false, input: ['text'],
      contextWindow: 8192, maxTokens: 16,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model) {
      const stream = createAssistantMessageEventStream();
      const message = { role: 'assistant', content: [{ type: 'text', text: 'fixture reply' }],
        api: model.api, provider: model.provider, model: model.id, stopReason: 'stop', timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      stream.push({ type: 'start', partial: message });
      setTimeout(() => {
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end(message);
      }, 800);
      return stream;
    },
  });
}
