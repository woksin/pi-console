// Run from the repository root; VHS provides a real 120×36 PTY on macOS.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const directory = `.ai-work/opentui-benchmark-${Date.now()}`;
mkdirSync(directory, { recursive: true });
const output = `${directory}/metrics.jsonl`;
const tape = `${directory}/stress.tape`;
writeFileSync(tape, `Output ${directory}/stress.gif
Set Shell "bash"
Set FontFamily "Menlo"
Set FontSize 16
Set Width 1262
Set Height 734
Set Padding 16
Hide
Type "PI_CONSOLE_URL=http://127.0.0.1:4778 PI_CONSOLE_METRICS_FILE=../../${output} npm --prefix spikes/tui-opentui start -- --colors truecolor"
Enter
Sleep 3s
Show
Enter
Sleep 17s
Up 3
Sleep 2s
Screenshot ${directory}/paused.png
Type "f"
Sleep 2s
Ctrl+P
Sleep 1s
Screenshot ${directory}/palette.png
Escape
Sleep 500ms
Type "q"
Sleep 500ms
Type "exit"
Enter
`);
const daemon = spawn(process.execPath, ['spikes/mock-daemon/server.ts', '--port', '4778', '--rate', '5000'], { stdio: ['ignore', 'pipe', 'inherit'] });
try {
  await new Promise((resolve, reject) => { daemon.stdout.once('data', resolve); daemon.once('error', reject); daemon.once('exit', code => reject(new Error(`Daemon exited ${code}`))); });
  const recording = spawn('vhs', [tape], { stdio: 'inherit' });
  await new Promise((resolve, reject) => { recording.once('error', reject); recording.once('exit', code => code === 0 ? resolve() : reject(new Error(`VHS exited ${code}`))); });
  const samples = readFileSync(output, 'utf8').trim().split('\n').map(JSON.parse).filter(s => s.seconds > 5);
  const average = key => samples.reduce((sum, s) => sum + s[key], 0) / samples.length;
  const peak = key => Math.max(...samples.map(s => s[key]));
  console.log(JSON.stringify({ samples: samples.length, cpuAveragePercent: average('cpuPercent'), cpuPeakPercent: peak('cpuPercent'), rssAverageMiB: average('rssMiB'), rssPeakMiB: peak('rssMiB'), loopP99PeakMs: peak('loopP99Ms'), updatesPerSecond: average('updatesPerSecond'), first: samples[0], last: samples.at(-1), raw: output }, null, 2));
} finally { daemon.kill('SIGTERM'); }
