import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from './config.ts';
import { startDaemon } from './daemon.ts';
import { loadToken } from './security/token.ts';

test('a busy port names the address, likely cause and --port remedy', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-busy-port-'));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });
  const blocker = createServer();
  await new Promise<void>(resolve => { blocker.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise<void>(resolve => { blocker.close(() => { resolve(); }); }));
  const port = (blocker.address() as { port: number }).port;
  await assert.rejects(startDaemon({ ...defaultConfig(directory), port, ingest: false }), {
    code: 'EADDRINUSE',
    message: `Port ${port} on 127.0.0.1 is in use; another daemon may be running. Stop it or use --port <n>.`,
  });
});

for (const name of ['token', 'memory-control-token']) {
  test(`a malformed ${name} names its path and remedy without revealing its content`, t => {
    const directory = mkdtempSync(join(tmpdir(), 'pi-console-invalid-token-'));
    t.after(() => { rmSync(directory, { recursive: true, force: true }); });
    const path = join(directory, name);
    writeFileSync(path, 'private-malformed-token');
    assert.throws(() => loadToken(directory, name), {
      message: `Invalid token file ${path}: expected 64 lowercase hex characters; delete it and restart the daemon to generate a new one.`,
    });
  });
}
