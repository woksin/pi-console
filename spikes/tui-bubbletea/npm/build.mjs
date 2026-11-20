// Build through pi-phase. Produces three platform packages and a tiny main pack.
import { mkdirSync, writeFileSync, statSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../../.ai-work/tasks/m0r2-bubbletea/output/npm');
mkdirSync(out, { recursive: true });
for (const [os, goos, arch, goarch] of [['darwin','darwin','arm64','arm64'], ['linux','linux','x64','amd64'], ['win32','windows','x64','amd64']]) {
  const key = `${os}-${arch}`;
  const dir = path.join(out, key);
  mkdirSync(path.join(dir, 'bin'), { recursive: true });
  const bin = path.join(dir, `bin/pi-console${os === 'win32' ? '.exe' : ''}`);
  execFileSync('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', bin, '.'], { cwd: path.resolve(here, '..'), env: { ...process.env, CGO_ENABLED:'0', GOOS:goos, GOARCH:goarch }, stdio:'inherit' });
  chmodSync(bin, 0o755);
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name:`@pi-console-spike/bubbletea-${key}`, version:'0.0.0-r2', os:[os], cpu:[arch], files:['bin'], license:'UNLICENSED' }, null, 2));
  execFileSync('npm', ['pack', '--pack-destination', out], { cwd:dir, stdio:'inherit' });
  console.log(`${key}: ${statSync(bin).size} bytes`);
}
chmodSync(path.join(here, 'cli.cjs'), 0o755);
execFileSync('npm', ['pack', '--pack-destination', out], { cwd:here, stdio:'inherit' });
console.log(`Tarballs: ${out}`);
