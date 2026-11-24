import { test } from 'node:test';
import { connectFlow, firstRunFlow, liveFleetFlow, memoryReviewFlow } from '../../../scripts/media/web-flows.ts';

// The gallery's four live flows run with no encoder: the behaviour they show is asserted here, the pictures are `npm run media`'s.
test('a visitor without a launch link pastes the token, connects and the token never reaches the address bar', { timeout: 60000 }, async () => { await connectFlow(); });
test('a connected daemon with no data shows the first-run checklist from an empty snapshot and no attention', { timeout: 60000 }, async () => { await firstRunFlow(); });
test('a finished session and a new blocking question arrive over SSE and raise the Needs you count without a reload', { timeout: 60000 }, async () => { await liveFleetFlow(); });
test('a memory review stays proposed through request and receipts and turns active only on the producer update', { timeout: 60000 }, async () => { await memoryReviewFlow(); });
