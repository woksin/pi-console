import { runCrashChild } from './crash-harness.ts';

const [path, total] = process.argv.slice(2);
await runCrashChild(path, Number(total));
