#!/usr/bin/env node
import process from 'node:process';
import console from 'node:console';
import { nodeVersionError } from './node-version.mjs';
export { nodeVersionError } from './node-version.mjs';

const versionError = nodeVersionError(process.versions.node);
if (versionError) {
  console.error(versionError);
  process.exitCode = 1;
} else {
  const { runCli } = await import('../src/main.ts');
  process.exitCode = await runCli(process.argv.slice(2));
}
