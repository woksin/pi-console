// PTY measurement with the system expect; artifacts remain ignored under .ai-work/.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { startDaemon } from '../mock-daemon/server.ts';

mkdirSync('.ai-work', { recursive: true });
const directory = mkdtempSync('.ai-work/pitui-stress-');
const daemon = await startDaemon({ port: 0, rate: 5000, dataDirectory: directory });
const pidFile = resolve(directory, 'pid');
const entry = resolve('spikes/tui-pitui/main.ts');
const token = resolve(directory, 'token');
const command = `stty cols 120 rows 36; echo $$ > '${pidFile}'; exec '${process.execPath}' '${entry}' --url http://127.0.0.1:${daemon.port} --token-file '${token}' --colors truecolor --duration 24`;
const readyFile = resolve(directory, 'ready');
const expect = `
  log_user 0
  set timeout 30
  spawn -noecho /bin/bash -c $env(PITUI_COMMAND)
  after 500 { send "\\r" }
  after 6500 { send "k" }
  after 8500 { send "f" }
  after 10500 { send ":theme\\r" }
  after 14500 { send "?" }
  after 16500 { send "\\033" }
  after 22000 { send "q" }
  expect "CONNECTED"
  set ready [open $env(PITUI_READY) w]
  puts $ready "ready"
  close $ready
  expect eof
  catch wait result
  exit [lindex $result 3]
`;
const child = spawn('expect', ['-c', expect], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, PITUI_COMMAND: command, PITUI_READY: readyFile, COLORTERM: 'truecolor', TERM: 'xterm-256color' } });
const exit = new Promise<number | null>(done => child.once('exit', done));
const samples: { second: number; cpu: number; rssMiB: number }[] = [];
try {
  const started = performance.now();
  let pid = 0;
  for (let i = 0; i < 50; i++) {
    try { readFileSync(readyFile); pid = Number(readFileSync(pidFile, 'utf8')); } catch {}
    if (pid) break;
    await delay(20);
  }
  assert(pid > 0, 'PTY child failed to start');
  const startMs = performance.now() - started;
  for (let second = 1; second <= 20; second++) {
    await delay(1000);
    assert.equal(child.exitCode, null, 'TUI exited before measurement ended');
    const [cpu, rss] = execFileSync('ps', ['-p', String(pid), '-o', '%cpu=,rss='], { encoding: 'utf8' }).trim().split(/\s+/).map(Number);
    samples.push({ second, cpu, rssMiB: rss / 1024 });
  }
  assert.equal(await exit, 0);
  const summary = {
    rate: 5000, seconds: 20, viewport: '120x36', startToConnectedMs: Math.round(startMs),
    cpuMean: samples.reduce((sum, sample) => sum + sample.cpu, 0) / samples.length,
    cpuPeak: Math.max(...samples.map(sample => sample.cpu)),
    rssMeanMiB: samples.reduce((sum, sample) => sum + sample.rssMiB, 0) / samples.length,
    rssPeakMiB: Math.max(...samples.map(sample => sample.rssMiB)), samples,
  };
  writeFileSync(resolve(directory, 'metrics.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Raw samples: ${directory}/metrics.json`);
} finally {
  if (child.exitCode === null) { child.kill('SIGTERM'); await exit; }
  await daemon.close();
}
