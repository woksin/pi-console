import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { startDemo, root } from '../demo.mjs';
import { encodeRecording } from './encode.mjs';

const demo = await startDemo();
try {
  await new Promise((done, reject) => {
    const child = spawn('vhs', ['scripts/media/tui.tape'], {
      cwd: root, stdio: 'inherit',
      env: {
        ...process.env, PI_CONSOLE_URL: `http://127.0.0.1:${demo.port}`,
        PI_CONSOLE_DEMO_TOKEN_FILE: demo.tokenFile, PI_CONSOLE_THEME: 'midnight',
        PI_CONSOLE_REDUCED_MOTION: '1', PI_CONSOLE_NOW: '2026-11-20T12:00:00Z',
      },
    });
    child.once('error', reject);
    child.once('exit', code => { if (code === 0) done(); else reject(new Error(`VHS exited ${code}`)); });
  });
  encodeRecording(join(root, '.ai-work/media-work/tui-vhs.gif'), join(process.env.MEDIA_OUT, 'tui-vhs.gif'));
} finally { await demo.close(); }
