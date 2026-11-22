import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forgetToken, loadToken, saveToken, tabTokenStorage, tokenFromFragment, type TokenStorage } from './token.ts';

const token = 'valid-token-for-this-tab';

function storage(initial: string | null = null): TokenStorage {
  let value = initial;
  return { getItem: () => value, setItem: (_key, next) => { value = next; }, removeItem: () => { value = null; } };
}

function unavailable(): never { throw new Error('Storage disabled'); }

for (const fragment of ['#token=%', '#token=%E0%A4%A', '#token=%FF']) {
  test(`malformed token fragment ${fragment} shows token entry`, () => {
    assert.equal(tokenFromFragment(fragment), null);
    assert.deepEqual(loadToken(storage(token), fragment), { token: null, cleanHash: '' });
  });
}

test('valid launch token is decoded, persisted and removed from the hash', () => {
  const target = storage();
  assert.deepEqual(loadToken(target, `#token=${token}`), { token, cleanHash: '' });
  assert.equal(loadToken(target, '').token, token);
});

test('bootstrap survives a throwing storage read', () => {
  assert.equal(loadToken({ ...storage(), getItem: unavailable }, '').token, null);
});

test('bootstrap keeps a launch token when storage writes and reads throw', () => {
  const target = { getItem: unavailable, setItem: unavailable, removeItem: unavailable };
  assert.equal(loadToken(target, `#token=${token}`).token, token);
  assert.equal(loadToken(target, '').token, token);
});

test('submitted token stays in tab memory when storage is unavailable', () => {
  const target = { getItem: unavailable, setItem: unavailable, removeItem: unavailable };
  saveToken(target, token);
  assert.equal(loadToken(target, '').token, token);
});

test('rejection clears tab memory even when storage removal throws', () => {
  const target = { ...storage(token), removeItem: unavailable };
  assert.equal(loadToken(target, '').token, token);
  forgetToken(target);
  assert.equal(loadToken(target, '').token, null);
});

test('rejection clears an in-memory submission with completely unavailable storage', () => {
  const target = { getItem: unavailable, setItem: unavailable, removeItem: unavailable };
  saveToken(target, token);
  forgetToken(target);
  assert.equal(loadToken(target, '').token, null);
});

test('browser storage property access may throw throughout sign-in and rejection', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: unavailable });
  try {
    assert.equal(loadToken(tabTokenStorage, '').token, null);
    saveToken(tabTokenStorage, token);
    assert.equal(loadToken(tabTokenStorage, '').token, token);
    forgetToken(tabTokenStorage);
    assert.equal(loadToken(tabTokenStorage, '').token, null);
  } finally {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

test('normal storage submission and rejection still persist and remove the token', () => {
  const target = storage();
  saveToken(target, token);
  assert.equal(target.getItem('pi-console.token'), token);
  forgetToken(target);
  assert.equal(target.getItem('pi-console.token'), null);
});
