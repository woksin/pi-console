import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPrefsStore } from './prefs.ts';

function environment(initial: object | null = {}, reduced = false) {
  const values = new Map<string, string>(initial === null ? [] : [['pi-console.prefs', JSON.stringify(initial)]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const motion = Object.assign(new EventTarget(), { matches: reduced });
  const changeMotion = (matches: boolean): void => { motion.matches = matches; motion.dispatchEvent(new Event('change')); };
  return { storage, motion, changeMotion, persisted: () => JSON.parse(values.get('pi-console.prefs') ?? '{}') as object };
}

test('reduced motion follows OS changes while subscribed and retains stable snapshots', () => {
  const env = environment();
  const store = createPrefsStore(env.storage, env.motion);
  let notifications = 0;
  const unsubscribe = store.subscribe(() => { notifications++; });
  assert.equal(store.snapshot().reducedMotion, false);
  assert.equal(store.snapshot(), store.snapshot());
  env.changeMotion(true);
  assert.equal(store.snapshot().reducedMotion, true);
  env.changeMotion(false);
  assert.equal(store.snapshot().reducedMotion, false);
  assert.equal(notifications, 2);
  unsubscribe();
  env.changeMotion(true);
  assert.equal(notifications, 2);
  assert.equal(store.snapshot().reducedMotion, true, 'a later subscriber also sees the current OS preference');
});

test('fresh preferences follow system changes without writing storage', () => {
  const env = environment(null);
  const store = createPrefsStore(env.storage, env.motion);
  const unsubscribe = store.subscribe(() => undefined);
  assert.equal(store.snapshot().reducedMotion, false);
  env.changeMotion(true);
  assert.equal(store.snapshot().reducedMotion, true);
  assert.equal(env.storage.getItem('pi-console.prefs'), null);
  unsubscribe();
});

test('theme and sidebar saves do not persist the resolved OS motion preference', () => {
  const env = environment({}, true);
  const store = createPrefsStore(env.storage, env.motion);
  store.set({ theme: 'dawn' });
  store.set({ sidebarCollapsed: true });
  assert.deepEqual(env.persisted(), { theme: 'dawn', sidebarCollapsed: true, version: 1 });
  env.changeMotion(false);
  assert.equal(store.snapshot().reducedMotion, false);
  assert.deepEqual(createPrefsStore(env.storage, env.motion).snapshot(), { theme: 'dawn', sidebarCollapsed: true, reducedMotion: false, motionChoice: 'system' });
});

for (const choice of [false, true]) {
  test(`an explicit reduced-motion choice of ${String(choice)} survives OS changes and reloads`, () => {
    const env = environment({}, !choice);
    const store = createPrefsStore(env.storage, env.motion);
    const unsubscribe = store.subscribe(() => undefined);
    store.set({ reducedMotion: choice });
    env.changeMotion(choice);
    env.changeMotion(!choice);
    assert.equal(store.snapshot().reducedMotion, choice);
    store.set({ theme: 'contrast' });
    assert.deepEqual(env.persisted(), { reducedMotion: choice, theme: 'contrast', version: 1 });
    assert.equal(createPrefsStore(env.storage, env.motion).snapshot().reducedMotion, choice);
    unsubscribe();
  });
}

for (const legacy of [false, true]) {
  test(`legacy motion value ${String(legacy)} is dropped once while other preferences survive`, () => {
    const env = environment({ theme: 'dawn', sidebarCollapsed: true, reducedMotion: legacy }, !legacy);
    const store = createPrefsStore(env.storage, env.motion);
    const unsubscribe = store.subscribe(() => undefined);
    assert.deepEqual(store.snapshot(), { theme: 'dawn', sidebarCollapsed: true, reducedMotion: !legacy, motionChoice: 'system' });
    assert.deepEqual(env.persisted(), { theme: 'dawn', sidebarCollapsed: true, version: 1 });
    env.changeMotion(legacy);
    assert.equal(store.snapshot().reducedMotion, legacy);
    store.set({ reducedMotion: !legacy });
    assert.equal(createPrefsStore(env.storage, env.motion).snapshot().reducedMotion, !legacy, 'the migration does not discard later explicit choices');
    unsubscribe();
  });
}

test('following system motion clears an explicit choice and survives reloads', () => {
  const env = environment({ reducedMotion: false, theme: 'contrast', version: 1 }, true);
  const store = createPrefsStore(env.storage, env.motion);
  const unsubscribe = store.subscribe(() => undefined);
  store.followSystemMotion();
  assert.equal(store.snapshot().reducedMotion, true);
  assert.deepEqual(env.persisted(), { theme: 'contrast', version: 1 });
  env.changeMotion(false);
  assert.equal(store.snapshot().reducedMotion, false);
  assert.equal(createPrefsStore(env.storage, env.motion).snapshot().reducedMotion, false);
  unsubscribe();
});

test('stored motion overrides remain explicit and unavailable storage remains tab-local', () => {
  const env = environment({ reducedMotion: false, version: 1 }, true);
  assert.equal(createPrefsStore(env.storage, env.motion).snapshot().reducedMotion, false);
  const unavailable = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const store = createPrefsStore(unavailable, env.motion);
  assert.equal(store.snapshot().reducedMotion, true);
  assert.doesNotThrow(() => { store.set({ reducedMotion: false }); });
  assert.equal(store.snapshot().reducedMotion, false);
});

test('the motion choice is System by default, then On or Off once chosen, and System again after following', () => {
  const env = environment({}, true);
  const store = createPrefsStore(env.storage, env.motion);
  const unsubscribe = store.subscribe(() => undefined);
  assert.equal(store.snapshot().motionChoice, 'system');
  store.set({ reducedMotion: false });
  assert.equal(store.snapshot().motionChoice, 'off');
  store.set({ reducedMotion: true });
  assert.equal(store.snapshot().motionChoice, 'on');
  store.followSystemMotion();
  assert.equal(store.snapshot().motionChoice, 'system');
  assert.equal(Object.hasOwn(env.persisted(), 'motionChoice'), false);
  unsubscribe();
});
