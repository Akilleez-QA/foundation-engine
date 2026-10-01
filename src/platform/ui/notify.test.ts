import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus } from '../../core/events';
import { createNotificationCenter, holdWhileNarrating, type Notice } from './notify';

const flush = () => new Promise<void>(r => setTimeout(r, 0));
const celebrate = (id: string, merge: string | null = 'discovery'): Notice => ({ id, channel: 'celebrate', icon: '⭐', titleKey: 'discovery.toast', ...(merge ? { merge } : {}) });
const shown = () => { const calls: string[][] = []; return { calls, renderer: { show: (ns: readonly Notice[]) => { calls.push(ns.map(n => n.id)); } } }; };

test('notify: a burst posted in one task reaches the renderer once, merged by key', async () => {
  const center = createNotificationCenter(), r = shown();
  center.render('celebrate', r.renderer);
  center.post(celebrate('a')); center.post(celebrate('b')); center.post(celebrate('c'));
  assert.deepEqual(r.calls, [], 'nothing is shown synchronously: the burst is still open');
  await flush();
  assert.deepEqual(r.calls, [['a', 'b', 'c']]);
  center.post(celebrate('d'));
  await flush();
  assert.deepEqual(r.calls, [['a', 'b', 'c'], ['d']], 'a later task is its own burst (the renderer merges it with what is on screen)');
});

test('notify: unmerged notices and other merge keys are separate groups, in posting order', async () => {
  const center = createNotificationCenter(), r = shown();
  center.render('celebrate', r.renderer);
  center.post(celebrate('x', null)); center.post(celebrate('a')); center.post(celebrate('y', null)); center.post(celebrate('b')); center.post(celebrate('m', 'other'));
  await flush();
  assert.deepEqual(r.calls, [['x'], ['a', 'b'], ['y'], ['m']]);
});

test('notify: holdWhile queues everything until every hold is released, then releases in order', async () => {
  const center = createNotificationCenter(), r = shown();
  center.render('celebrate', r.renderer);
  const one = new AbortController(), two = new AbortController();
  center.holdWhile(one.signal); center.holdWhile(two.signal);
  center.post(celebrate('a')); await flush(); center.post(celebrate('b')); await flush();
  assert.deepEqual(r.calls, []);
  one.abort(); await flush();
  assert.deepEqual(r.calls, [], 'one hold is still active');
  two.abort(); await flush();
  assert.deepEqual(r.calls, [['a', 'b']], 'held notices come out as one burst');
  center.holdWhile(AbortSignal.abort());
  center.post(celebrate('c')); await flush();
  assert.deepEqual(r.calls, [['a', 'b'], ['c']], 'an already-aborted signal holds nothing');
});

test('notify: narration.speaking holds the centre while the narrator speaks (events, no polling)', async () => {
  const bus = createEventBus(), center = createNotificationCenter(), r = shown();
  center.render('celebrate', r.renderer);
  const off = holdWhileNarrating(bus, center);
  bus.emit('narration.speaking', { speaking: true });
  bus.emit('narration.speaking', { speaking: true });
  center.post(celebrate('a')); await flush();
  assert.deepEqual(r.calls, []);
  bus.emit('narration.speaking', { speaking: false }); await flush();
  assert.deepEqual(r.calls, [['a']]);
  bus.emit('narration.speaking', { speaking: true });
  center.post(celebrate('b')); await flush();
  off(); await flush();
  assert.deepEqual(r.calls, [['a'], ['b']], 'unwiring releases a hold it made');
});

test('notify: notices wait for a late renderer; a removed renderer stops receiving', async () => {
  const center = createNotificationCenter({ limit: 2 }), r = shown();
  center.post(celebrate('a')); center.post(celebrate('b')); center.post(celebrate('c'));
  await flush();
  const off = center.render('celebrate', r.renderer); await flush();
  assert.deepEqual(r.calls, [['b', 'c']], 'only the newest `limit` waited');
  off();
  center.post(celebrate('d')); await flush();
  assert.deepEqual(r.calls, [['b', 'c']]);
});

test('notify: story notices are kept in the inbox (newest 50); others are not', async () => {
  const center = createNotificationCenter();
  for (let i = 0; i < 55; i++) center.post({ id: 's' + i, channel: 'story', icon: '✉️', titleKey: 'story.t' });
  center.post(celebrate('a'));
  const inbox = center.inbox();
  assert.equal(inbox.length, 50);
  assert.equal(inbox[0]!.id, 's5');
  assert.ok(inbox.every(n => n.channel === 'story'));
});

test('notify: a failing renderer does not stop the other groups', async () => {
  const center = createNotificationCenter(), got: string[] = [];
  const error = console.error; console.error = () => {};
  try {
    center.render('celebrate', { show: ns => { if (ns[0]!.id === 'bad') throw Error('boom'); got.push(ns[0]!.id); } });
    center.post(celebrate('bad', 'one')); center.post(celebrate('good', 'two'));
    await flush();
  } finally { console.error = error; }
  assert.deepEqual(got, ['good']);
});

// Explicit task boundaries make reentrant admission and pending retention observable without timers.
const deferredCenter = (limit = 2) => {
  const tasks: (() => void)[] = [];
  const center = createNotificationCenter({ limit, defer: fn => { tasks.push(fn); } });
  return { center, tasks, next: () => { tasks.shift()?.(); } };
};

test('notify: invalid limits are rejected before accepting notices', () => {
  for (const limit of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createNotificationCenter({ limit }), /positive safe integer/);
  }
});

test('notify: registered channels retain only newest pending posts during holds and bursts', () => {
  const { center, next } = deferredCenter(), a = shown(), b = shown();
  center.render('celebrate', a.renderer); center.render('hint', b.renderer);
  const hold = new AbortController(); center.holdWhile(hold.signal);
  for (let i = 0; i < 1000; i++) {
    center.post(celebrate(String(i)));
    center.post({ ...celebrate('h' + i), channel: 'hint' });
  }
  hold.abort(); next();
  assert.deepEqual(a.calls, [['998', '999']]); assert.deepEqual(b.calls, [['h998', 'h999']]);
  const same = celebrate('same');
  center.post(same); center.post(same); center.post(same); next();
  assert.deepEqual(a.calls[1], ['same', 'same'], 'overflow counts posts, not distinct object references');
});

test('notify: duplicate holds register one abort listener and all distinct holds must finish', () => {
  const { center, next, tasks } = deferredCenter(), r = shown();
  const a = new AbortController(), b = new AbortController();
  let listeners = 0;
  const original = a.signal.addEventListener.bind(a.signal);
  a.signal.addEventListener = (...args: Parameters<AbortSignal['addEventListener']>) => { listeners++; original(...args); };
  center.render('celebrate', r.renderer);
  center.holdWhile(a.signal); center.holdWhile(a.signal); center.holdWhile(b.signal);
  center.post(celebrate('a')); a.abort();
  assert.equal(listeners, 1); assert.equal(tasks.length, 0);
  b.abort(); next(); assert.deepEqual(r.calls, [['a']]);
});

test('notify: callback hold pauses remaining groups; callback posts stay bounded and form a later burst', () => {
  const { center, next, tasks } = deferredCenter(3), calls: string[][] = [];
  const hold = new AbortController();
  center.render('celebrate', { show(ns) {
    calls.push(ns.map(n => n.id));
    if (ns[0]!.id === 'first') {
      center.holdWhile(hold.signal);
      for (let i = 0; i < 10; i++) center.post(celebrate('new' + i));
    }
  } });
  center.post(celebrate('first', null)); center.post(celebrate('old', null)); next();
  assert.deepEqual(calls, [['first']]); assert.equal(tasks.length, 0);
  hold.abort(); next();
  assert.deepEqual(calls, [['first'], ['new7', 'new8', 'new9']]);
});

test('notify: removing a renderer inside show retains remaining groups for a later registration', () => {
  const { center, next } = deferredCenter(4), calls: string[][] = [];
  const off = center.render('celebrate', { show(ns) { calls.push(ns.map(n => n.id)); off(); } });
  center.post(celebrate('first', null)); center.post(celebrate('second', null)); next();
  assert.deepEqual(calls, [['first']]);
  const late = shown(); center.render('celebrate', late.renderer); next();
  assert.deepEqual(late.calls, [['second']]);
});

test('notify: reentrant posts wait for another burst and replacement registrations survive stale removals', async () => {
  const { center, next } = deferredCenter(4), calls: string[][] = [];
  const replacement = shown();
  center.render('celebrate', { show(ns) {
    calls.push(ns.map(n => n.id)); center.post(celebrate('new', null));
    const stale = center.render('celebrate', replacement.renderer);
    center.render('celebrate', replacement.renderer); stale();
  } });
  center.post(celebrate('first', null)); center.post(celebrate('second', null)); next();
  assert.deepEqual(calls, [['first']]); assert.deepEqual(replacement.calls, [['second']]);
  await flush(); assert.deepEqual(replacement.calls, [['second'], ['new']]);
});

test('notify: admission snapshots channel and isolates caller, renderer and inbox data', () => {
  const { center, next } = deferredCenter(2);
  const original: Notice = { id: 'one', channel: 'story', icon: '', titleKey: 't', params: { value: 1 }, action: { labelKey: 'a', route: 'original' } };
  center.post(original);
  original.channel = 'hint'; original.params!.value = 99; original.action!.route = 'changed';
  center.render('story', { show(ns) { ns[0]!.params!.value = 20; ns[0]!.action!.route = 'renderer'; ns[0]!.channel = 'system'; } });
  next();
  const first = center.inbox();
  assert.equal(first[0]!.channel, 'story'); assert.equal(first[0]!.params!.value, 1); assert.equal(first[0]!.action!.route, 'original');
  first[0]!.params!.value = 30; first[0]!.action!.route = 'inbox';
  assert.equal(center.inbox()[0]!.params!.value, 1); assert.equal(center.inbox()[0]!.action!.route, 'original');
  center.post(original); original.channel = 'story'; center.post(original); original.channel = 'hint'; center.post(original);
  assert.equal(center.inbox().length, 2);
});

test('notify: a synchronous release may restart narration without losing the new hold', () => {
  const bus = createEventBus(), center = createNotificationCenter({ defer: fn => fn() }), calls: string[] = [];
  const off = holdWhileNarrating(bus, center);
  center.render('celebrate', { show(ns) { calls.push(ns[0]!.id); if (ns[0]!.id === 'first') bus.emit('narration.speaking', { speaking: true }); } });
  bus.emit('narration.speaking', { speaking: true });
  center.post(celebrate('first', null)); center.post(celebrate('second', null));
  bus.emit('narration.speaking', { speaking: false });
  assert.deepEqual(calls, ['first']);
  bus.emit('narration.speaking', { speaking: false });
  assert.deepEqual(calls, ['first', 'second']); off();
});

test('notify: synchronous scheduler does not recursively consume callback-generated chains', async () => {
  const center = createNotificationCenter({ defer: fn => fn() });
  let delivered = 0;
  center.render('celebrate', { show() { if (++delivered < 10000) center.post(celebrate(String(delivered), null)); } });
  center.post(celebrate('start', null));
  assert.equal(delivered, 1, 'reentrant delivery crosses a real async boundary');
  await flush(); assert.equal(delivered, 10000, 'finite chain completes without recursive stack growth');
});

test('notify: failed injected scheduler leaves accepted notices retryable', () => {
  let fail = true;
  const center = createNotificationCenter({ defer(fn) { if (fail) throw Error('scheduler failed'); fn(); } }), r = shown();
  center.render('celebrate', r.renderer);
  assert.throws(() => center.post(celebrate('first')), /scheduler failed/);
  fail = false; center.post(celebrate('second'));
  assert.deepEqual(r.calls, [['first', 'second']]);
});

test('notify: retired narration binding ignores delivery captured before unsubscribe', () => {
  const bus = createEventBus(), center = createNotificationCenter({ defer: fn => fn() }), r = shown();
  let retire = () => {};
  bus.on('narration.speaking', () => retire());
  retire = holdWhileNarrating(bus, center);
  center.render('celebrate', r.renderer);
  bus.emit('narration.speaking', { speaking: true });
  center.post(celebrate('free'));
  assert.deepEqual(r.calls, [['free']], 'captured retired callback cannot establish a new hold');
});
