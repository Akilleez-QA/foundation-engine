import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeResponse} from './client-protocol.mjs';
const context = () => ({
  principal: 'alpha',
  pending: new Map([
    ['own', 'alpha'],
    ['cross', 'beta'],
  ]),
});
const result = (patch = {}) => ({
  v: 1,
  type: 'result',
  id: 'own',
  target: 'alpha',
  value: 4,
  applied: true,
  ...patch,
});
const decode = (value, state = context()) => decodeResponse(JSON.stringify(value), state);

test('strict reference responses return frozen detached fields without consuming pending requests', () => {
  const state = context(),
    frame = result();
  const accepted = decode(frame, state);
  frame.value = 99;
  assert.deepEqual(accepted, result());
  assert.ok(Object.isFrozen(accepted));
  assert.deepEqual(
    [...state.pending],
    [
      ['own', 'alpha'],
      ['cross', 'beta'],
    ],
  );
  assert.deepEqual(decode({v: 1, type: 'authenticated', principal: 'beta'}, {principal: null, pending: new Map()}), {
    v: 1,
    type: 'authenticated',
    principal: 'beta',
  });
  assert.deepEqual(decode({v: 1, type: 'refused', reason: 'unauthorized', id: 'cross'}, state), {
    v: 1,
    type: 'refused',
    reason: 'unauthorized',
    id: 'cross',
  });
  assert.deepEqual(decode({v: 1, type: 'refused', reason: 'schema'}), {
    v: 1,
    type: 'refused',
    reason: 'schema',
  });
});

test('a result must match both the original requested target and the current authenticated principal', () => {
  for (const frame of [
    result({id: 'cross'}),
    result({id: 'cross', target: 'beta'}),
    result({target: 'beta'}),
    result({id: 'unknown'}),
  ])
    assert.throws(() => decode(frame));
  assert.throws(() => decode(result(), {principal: null, pending: new Map([['own', 'alpha']])}));
  assert.throws(
    () => decode({v: 1, type: 'authenticated', principal: 'beta'}, context()),
    'active principal cannot be replaced by a response',
  );
});

test('unexpected sensitive fields and nonexact authentication/result/refusal schemas are rejected', () => {
  for (const frame of [
    result({credential: 'secret'}),
    {v: 1, type: 'authenticated', principal: 'alpha', token: 'secret'},
    {v: 1, type: 'refused', reason: 'no', id: 'own', privateCounter: 77},
    {v: 1, type: 'result', id: 'own', target: 'alpha', value: 1},
    {v: 1, type: 'authenticated'},
    {v: 1, type: 'refused'},
    [result()],
  ])
    assert.throws(() =>
      decode(frame, frame?.type === 'authenticated' ? {principal: null, pending: new Map()} : context()),
    );
  const state = context();
  assert.throws(() =>
    decodeResponse(
      '{"v":1,"type":"result","id":"own","target":"alpha","value":1,"applied":true,"__proto__":{}}',
      state,
    ),
  );
  assert.equal(state.pending.size, 2);
});

test('unknown refused IDs, coerced values, invalid versions and overlong reasons are rejected', () => {
  for (const frame of [
    result({v: '1'}),
    result({v: 2}),
    result({value: '4'}),
    result({value: -1}),
    result({value: 100001}),
    result({value: 1.5}),
    result({applied: 1}),
    result({id: 'bad id'}),
    {v: 1, type: 'refused', reason: 'no', id: 'unknown'},
    {v: 1, type: 'refused', reason: 5},
    {v: 1, type: 'refused', reason: 'x'.repeat(129)},
    {v: 1, type: 'refused', reason: 'no', id: null},
    {v: 1, type: 'authenticated', principal: 'other'},
  ])
    assert.throws(() => decode(frame));
  assert.equal(decode({v: 1, type: 'refused', reason: 'x'.repeat(128)}).reason.length, 128);
  assert.equal(decode(result({value: 0})).value, 0);
  assert.equal(decode(result({value: 100000})).value, 100000);
});

test('response text has a UTF-8 bound and malformed JSON cannot become an accepted frame', () => {
  for (const raw of [
    '{',
    'null',
    'false',
    '"hello"',
    'x'.repeat(1025),
    JSON.stringify({v: 1, type: 'refused', reason: '界'.repeat(400)}),
  ])
    assert.throws(() => decodeResponse(raw, context()));
  assert.throws(() => decodeResponse(result(), context()));
});

test('NW-08 drain notices decode with exact fields and integer windows only', () => {
  const notice = {v: 1, type: 'drain', cause: 'planned', closeInMs: 500, reconnectAfterMs: 2000};
  const accepted = decode(notice);
  assert.deepEqual(accepted, notice);
  assert.ok(Object.isFrozen(accepted));
  assert.deepEqual(decode({...notice, cause: 'lifetime'}, {principal: null, pending: new Map()}).cause, 'lifetime');
  for (const bad of [
    {...notice, cause: 'shutdown'},
    {...notice, closeInMs: 1.5},
    {...notice, reconnectAfterMs: '1'},
    {...notice, extra: true},
    {v: 1, type: 'drain', cause: 'planned', closeInMs: 1},
  ])
    assert.throws(() => decode(bad), /drain response/, JSON.stringify(bad));
});
