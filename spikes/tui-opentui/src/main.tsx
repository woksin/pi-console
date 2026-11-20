import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { App } from './app.tsx';
import { Client } from './client.ts';
import type { Colors } from './theme.ts';
import { metrics } from './metrics.ts';

const colorFlag = process.argv.indexOf('--colors');
const colors = (colorFlag < 0 ? /truecolor|24bit/.test(process.env.COLORTERM ?? '') ? 'truecolor' : /256/.test(process.env.TERM ?? '') ? '256' : '16' : process.argv[colorFlag + 1]) as Colors;
if (!['16', '256', 'truecolor'].includes(colors)) throw new Error('Usage: npm start -- --colors 16|256|truecolor');
const client = Client.local();
const renderer = await createCliRenderer({ targetFps: 20, maxFps: 30, useMouse: true, exitOnCtrlC: false, backgroundColor: '#0b1019', onDestroy: () => client.stop() });
const quit = () => { client.stop(); renderer.destroy(); };
createRoot(renderer).render(<App store={client.store} colors={colors} quit={quit} load={id => client.transcript(id)} submit={input => client.intervene(input)} />);
client.start();
metrics(client.store);
