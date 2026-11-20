const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(`${__dirname}/cli.cjs`, 'utf8');
function launch(platform, arch, installed) {
  const result = { messages: [] };
  const process = { platform, arch, argv: ['node', 'cli', '--screen', 'graph'], exit(code) { result.code = code; throw new Error('exit'); } };
  function require() { return { spawnSync(file, args) { result.file = file; result.args = args; return { status: 0 }; } }; }
  require.resolve = name => { if (!installed) throw new Error('missing'); result.module = name; return '/binary'; };
  try { vm.runInNewContext(source, { require, process, console: { error(message) { result.messages.push(message); } } }); } catch (error) { if (error.message !== 'exit') throw error; }
  return result;
}
test('unsupported platform is explicit', () => {
  const result = launch('freebsd', 'x64', false);
  assert.equal(result.code, 1);
  assert.match(result.messages[0], /unsupported platform freebsd-x64/);
});
test('missing optional package explains remedy', () => {
  const result = launch('darwin', 'arm64', false);
  assert.equal(result.code, 1);
  assert.match(result.messages[0], /missing platform binary.*Optional dependencies must be enabled/);
});
test('matrix selects native binary and forwards arguments', () => {
  for (const [os, arch] of [['darwin','arm64'], ['linux','x64'], ['win32','x64']]) {
    const result = launch(os, arch, true);
    assert.equal(result.code, 0);
    assert.match(result.module, new RegExp(`bubbletea-${os}-${arch}/bin/pi-console`));
    assert.equal(JSON.stringify(result.args), JSON.stringify(['--screen', 'graph']));
    assert.equal(result.module.endsWith('.exe'), os === 'win32');
  }
});
