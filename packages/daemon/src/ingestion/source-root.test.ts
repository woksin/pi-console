import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceRoot } from './source-root.ts';

function directory(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'pi-console-configured-root-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

for (const late of [false, true]) {
  test(`configured nested relative aliases match realpath (${late ? 'pending' : 'startup'})`, t => {
    const root = directory(t);
    mkdirSync(join(root, 'store/config'), { recursive: true });
    symlinkSync('store/config', join(root, 'parent'));
    symlinkSync('../latest', join(root, 'store/config/root'));
    const configured = join(root, 'parent/root');
    if (!late) mkdirSync(join(root, 'store/latest'));
    const scope = new SourceRoot(configured);
    if (late) {
      assert.equal(scope.available(), undefined);
      mkdirSync(join(root, 'store/latest'));
    }
    assert.equal(scope.available(), realpathSync(configured));
    assert.equal(scope.path, realpathSync(join(root, 'store/latest')));
  });
}

test('configured aliases re-pin on availability checks and never use a stale pin after lookup errors', t => {
  const root = directory(t);
  const configured = join(root, 'configured');
  mkdirSync(join(root, 'first'));
  mkdirSync(join(root, 'second'));
  symlinkSync('first', configured);
  const scope = new SourceRoot(configured);
  assert.equal(scope.available(), realpathSync(join(root, 'first')));
  rmSync(configured);
  assert.equal(scope.available(), undefined);
  symlinkSync('second', configured);
  assert.equal(scope.available(), realpathSync(join(root, 'second')));
  rmSync(configured);
  symlinkSync('configured', configured);
  assert.equal(scope.available(), undefined);
});
