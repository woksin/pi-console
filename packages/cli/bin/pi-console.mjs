#!/usr/bin/env node
import process from 'node:process';
import console from 'node:console';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const { engines: { node: requiredNodeVersion } } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));

/** Check the minimum Node version before loading TypeScript or native dependencies. */
export function nodeVersionError(version, required = requiredNodeVersion) {
  const minimum = required.replace(/^>=/u, '').split('.').map(Number);
  const current = version.split('.').map(Number);
  for (let index = 0; index < minimum.length; index++) {
    if (current[index] > minimum[index]) return undefined;
    if (current[index] < minimum[index]) return `pi-console requires Node.js ${required} (running ${version}); install Node.js ${required} and retry.`;
  }
  return undefined;
}

const versionError = nodeVersionError(process.versions.node);
if (versionError) {
  console.error(versionError);
  process.exitCode = 1;
} else {
  const { runCli } = await import('../src/main.ts');
  process.exitCode = await runCli(process.argv.slice(2));
}
