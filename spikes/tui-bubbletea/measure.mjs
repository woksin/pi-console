// Run from the repository root. VHS supplies a real 120x36 PTY on macOS.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { startDaemon } from '../mock-daemon/server.ts';
const dir = '.ai-work/tasks/m0r2-bubbletea/output';
mkdirSync(dir, { recursive: true });
const pidFile = `${dir}/measure-${Date.now()}.pid`;
const tapeFile = `${dir}/stress.tape`;
const daemon = await startDaemon({port:0,rate:5000,dataDirectory:`${dir}/stress-daemon`});
const command = `stty cols 120 rows 36; echo $$ > ${pidFile}; exec ${dir}/npm/darwin-arm64/bin/pi-console --url http://127.0.0.1:${daemon.port} --token-file ${dir}/stress-daemon/token --screen graph --duration 23s --colors truecolor`;
writeFileSync(tapeFile, `Output ${dir}/stress.gif\nSet Shell bash\nSet Width 1144\nSet Height 700\nSet FontFamily "Menlo"\nSet FontSize 14\nSet LineHeight 1.15\nSet Padding 16\nSet Framerate 5\nHide\nSleep 1s\nType "${command}"\nEnter\nSleep 1s\nShow\nSleep 20s\n`);

let terminal;
try {
  await delay(600);
  const response = await fetch(`http://127.0.0.1:${daemon.port}/api/v0/overview`, { headers: { Authorization: `Bearer ${daemon.token}` } });
  if (!response.ok) throw new Error(`mock HTTP ${response.status}`);
  terminal = spawn('vhs', [tapeFile], { stdio: ['ignore', 'inherit', 'inherit'] });
  const exited = new Promise(resolve => terminal.on('exit', code => resolve(code)));
  let pid;
  for (let i = 0; i < 500; i++) {
    try { pid = Number(readFileSync(pidFile, 'utf8').trim()); break; } catch { await delay(50); }
  }
  if (!pid) throw new Error('TUI did not start');
  const samples = [];
  for (let i = 0; i < 20; i++) {
    await delay(1000);
    const values = execFileSync('ps', ['-p', String(pid), '-o', '%cpu=,rss=,time='], { encoding: 'utf8' }).trim().split(/\s+/);
    samples.push({ second: i + 1, cpuPercent: Number(values[0]), rssKiB: Number(values[1]), cpuTime: values[2] });
  }
  const code = await exited;
  if (code !== 0) throw new Error(`VHS exited ${code}`);
  const mean = key => samples.reduce((sum, s) => sum + s[key], 0) / samples.length;
  const result = { rate: 5000, sampleSeconds: 20, cpuMean: mean('cpuPercent'), cpuPeak: Math.max(...samples.map(s => s.cpuPercent)), rssMeanMiB: mean('rssKiB') / 1024, rssPeakMiB: Math.max(...samples.map(s => s.rssKiB)) / 1024, samples };
  writeFileSync(`${dir}/measure.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  terminal?.kill('SIGTERM');
  await daemon.close();
}
