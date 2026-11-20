#!/usr/bin/env node
'use strict';
const { spawnSync } = require('node:child_process');
const key = `${process.platform}-${process.arch}`;
const supported = ['darwin-arm64', 'linux-x64', 'win32-x64'];
function fail(message) {
  console.error(`pi-console-bubbletea: ${message}`);
  process.exit(1);
}
if (!supported.includes(key)) fail(`unsupported platform ${key}; supported: ${supported.join(', ')}. Build from Go source for other targets.`);
const dependency = `@pi-console-spike/bubbletea-${key}`;
let executable;
try {
  executable = require.resolve(`${dependency}/bin/pi-console${process.platform === 'win32' ? '.exe' : ''}`);
} catch {
  fail(`missing platform binary ${dependency}. Optional dependencies must be enabled (do not use --omit=optional). For this local-only spike install the matching platform tarball beside the main package.`);
}
const result = spawnSync(executable, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) fail(`cannot start ${dependency}: ${result.error.message}`);
if (result.signal) process.kill(process.pid, result.signal);
process.exit(result.status ?? 1);
