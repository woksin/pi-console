import { entry, insertSorted, markDirty, orderKey, projection } from '../projector/handlers.ts';

export interface BurnSample { at: string; contextPercent: number; tokens: number }

export interface SessionBurn {
  contextPercent: number;
  /** orderKey of the sample behind `contextPercent`. */
  contextKey: string;
  /** Cumulative input + output tokens reported by finished turns. */
  tokens: number;
  /** Most recent samples by occurredAt, oldest first. */
  samples: BurnSample[];
}

export interface BurnState { sessions: Record<string, SessionBurn> }

/** Samples kept per session; matches the API's 24-point sparkline. */
export const burnWindow = 24;

const blank = (): SessionBurn => ({ contextPercent: 0, contextKey: '', tokens: 0, samples: [] });

/** Inserts in occurredAt order (late backfill lands in its place) and keeps the newest `burnWindow`. */
function insertSample(burn: SessionBurn, sample: BurnSample): void {
  insertSorted(burn.samples, sample, item => `${item.at}|${String(item.contextPercent).padStart(3, '0')}|${String(item.tokens).padStart(16, '0')}`);
  if (burn.samples.length > burnWindow) burn.samples.splice(0, burn.samples.length - burnWindow);
}

/** Context pressure and token burn per session. */
export const burnProjection = projection<BurnState>('burn', 2, () => ({ sessions: {} }), {
  ContextPressureSampled(state, payload, event) {
    markDirty(state, 'sessions', payload.sessionId);
    const burn = entry(state.sessions, payload.sessionId, blank);
    const key = orderKey(event);
    if (key >= burn.contextKey) {
      burn.contextPercent = payload.percent;
      burn.contextKey = key;
    }
    insertSample(burn, { at: event.occurredAt, contextPercent: payload.percent, tokens: payload.tokens ?? burn.tokens });
  },
  TurnEnded(state, payload) {
    if (!payload.usage) return;
    markDirty(state, 'sessions', payload.sessionId);
    entry(state.sessions, payload.sessionId, blank).tokens += payload.usage.inputTokens + payload.usage.outputTokens;
  },
}, ['sessions']);
