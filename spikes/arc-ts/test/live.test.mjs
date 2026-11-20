import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function start(t) {
    const child = spawn(process.execPath, ['dist/server/main.js'], {
        env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit']
    });
    const exited = once(child, 'exit');
    t.after(async () => { child.kill('SIGTERM'); await exited; });
    let output = '';
    const ready = new Promise(resolve => child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/READY (\{[^\n]+\})/);
        if (match) resolve(`http://127.0.0.1:${JSON.parse(match[1]).port}`);
    }));
    return Promise.race([ready, exited.then(code => { throw new Error(`Server exit: ${code}`); })]);
}

async function* frames(body) {
    let buffer = '';
    for await (const chunk of body.pipeThrough(new TextDecoderStream())) {
        buffer += chunk;
        let split;
        while ((split = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const data = frame.split('\n').filter(line => line.startsWith('data:'))
                .map(line => line.slice(5).trim()).join('\n');
            if (data) yield JSON.parse(data);
        }
    }
}

test('Hono + Arc + Drizzle: snapshot, direct SSE and command -> live update within 2s',
    { timeout: 20_000 }, async t => {
        const origin = await start(t);
        const page = await fetch(origin);
        assert.equal(page.status, 200);
        assert.match(await page.text(), /M0 Arc live rows/);
        const snapshot = await fetch(`${origin}/api/all`);
        assert.equal(snapshot.status, 200);
        assert.deepEqual((await snapshot.json()).data, []);
        const controller = new AbortController();
        t.after(() => controller.abort());
        const response = await fetch(`${origin}/api/all`, {
            headers: { Accept: 'text/event-stream' }, signal: controller.signal
        });
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /text\/event-stream/);
        const stream = frames(response.body);
        assert.deepEqual((await stream.next()).value.data, []);
        const row = { id: crypto.randomUUID(), title: 'live without reload' };
        const started = performance.now();
        const command = await fetch(`${origin}/api/add-row`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row)
        });
        assert.equal(command.status, 200);
        assert.equal((await command.json()).isSuccess, true);
        const timer = setTimeout(() => controller.abort(), Math.max(1, 2000 - (performance.now() - started)));
        try {
            assert.deepEqual((await stream.next()).value.data, [row]);
            const latency = performance.now() - started;
            assert.ok(latency < 2000, `Update latency ${latency}ms`);
            console.log(`Command -> SSE update: ${latency.toFixed(1)}ms`);
        } finally { clearTimeout(timer); controller.abort(); }
        const updated = await fetch(`${origin}/api/all`);
        assert.deepEqual((await updated.json()).data, [row]);
    });
