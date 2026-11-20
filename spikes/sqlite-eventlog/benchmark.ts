import { fork } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { SqliteEventLog, type Driver } from './event-log.ts';

const root = fileURLToPath(new URL('../../.ai-work/m0-sqlite-bench/', import.meta.url));
const drivers: Driver[] = ['node:sqlite', 'better-sqlite3'];
const count = 1_000_000;
const payload = { text: 'x'.repeat(289) }; // Exactly 300 UTF-8 JSON bytes.

function measure(driver: Driver): void {
    mkdirSync(root, { recursive: true });
    const path = `${root}/${driver.replace(':', '-')}-${Date.now()}.sqlite`;
    const log = new SqliteEventLog(driver, path);
    const start = performance.now();
    for (let offset = 0; offset < count; offset += 1000) {
        log.append(Array.from({ length: 1000 }, (_, index) => ({
            idempotencyKey: `event-${offset + index}`, type: 'Observed', version: 1, payload
        })));
    }
    const appended = performance.now();
    let cursor = 0;
    let replayed = 0;
    for (;;) {
        const events = log.readFrom(cursor, 1000);
        if (!events.length) break;
        cursor = events.at(-1)!.seq;
        replayed += events.length;
    }
    const end = performance.now();
    log.close(); // Last connection closes/checkpoints WAL before file size measurement.
    if (replayed !== count) throw new Error(`Replay count ${replayed}`);
    console.log(JSON.stringify({ driver, events: count, batch: 1000,
        payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
        appendPerSecond: Math.round(count * 1000 / (appended - start)),
        replayPerSecond: Math.round(count * 1000 / (end - appended)),
        appendSeconds: (appended - start) / 1000, replaySeconds: (end - appended) / 1000,
        databaseBytes: statSync(path).size,
        peakRssMiB: process.resourceUsage().maxRSS / 1024 }));
}

if (process.argv[2]) {
    measure(process.argv[2] as Driver);
} else {
    // Fresh process for each driver, so peak RSS is not inherited from the first run.
    for (const driver of drivers) {
        const child = fork(fileURLToPath(import.meta.url), [driver], { stdio: 'inherit' });
        const code = await new Promise<number | null>(resolve => child.once('exit', resolve));
        if (code !== 0) throw new Error(`${driver} benchmark exited ${code}`);
    }
}
