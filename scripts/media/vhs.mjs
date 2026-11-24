import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { startDemo, root } from '../demo.mjs';
import { fixedNow } from './scenes.ts';
import { encodeRecording } from './encode.mjs';

const now = new Date(fixedNow);
const demo = await startDemo(undefined, () => now);
let child;
// On Ctrl-C or SIGTERM, stop VHS so the finally block below still shuts the demo daemon down.
const interrupt = () => { child?.kill('SIGTERM'); };
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
try {
  await new Promise((done, reject) => {
    child = spawn('vhs', ['scripts/media/tui.tape'], {
      cwd: root, stdio: 'inherit',
      env: {
        ...process.env, PI_CONSOLE_URL: `http://127.0.0.1:${demo.port}`,
        PI_CONSOLE_DEMO_TOKEN_FILE: demo.tokenFile, PI_CONSOLE_THEME: 'midnight',
        PI_CONSOLE_REDUCED_MOTION: '1', PI_CONSOLE_NOW: now.toISOString(), TZ: 'UTC',
      },
    });
    child.once('error', reject);
    child.once('exit', code => { if (code === 0) done(); else reject(new Error(`VHS exited ${code}`)); });
  });
  encodeRecording(join(root, '.ai-work/media-work/tui-vhs.gif'), join(process.env.MEDIA_OUT, 'tui-vhs.gif'));
} finally { await demo.close(); }
