#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 26 || (major === 26 && minor < 8)) {
  console.error('pi-console-opentui requires Node >=26.8 with experimental FFI support.');
  process.exit(1);
}
const platforms = new Set(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64']);
const platform = `${process.platform}-${process.arch}`;
if (!platforms.has(platform)) {
  console.error(`pi-console-opentui: unsupported platform ${platform}. OpenTUI requires a supported native binary.`);
  process.exit(1);
}
if (process.argv.includes('--version')) {
  console.log('pi-console-opentui 0.0.2');
  process.exit(0);
}
const child = spawn(process.execPath, ['--experimental-ffi', '--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../src/main.tsx', import.meta.url)), ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, TSX_TSCONFIG_PATH: fileURLToPath(new URL('../tsconfig.json', import.meta.url)) } });
child.on('error', error => { console.error(`pi-console-opentui: ${error.message}`); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
