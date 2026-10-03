// gameActionsPressedBy: which of the game's own actions a held bench key presses (W1-4 review: a still active window
// is one whose held keys press nothing the game binds; the engine's Back, pause and mute never count).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_INPUT_ACTIONS } from '../platform/input/actions';
import { actionRows, GAME_MODULE_ID } from './compile';
import { defineInput } from './defs';
import { gameActionsPressedBy, keyEventOf } from './input-registry';

const rows = (...inputs: ReturnType<typeof defineInput>[]) => [
  ...CORE_INPUT_ACTIONS.map(row => ({ row, source: 'platform.input' })),
  ...inputs.flatMap(i => actionRows(i).map(row => ({ row, source: GAME_MODULE_ID }))),
];

test('keyEventOf: automation key names map to the key and code a browser sends', () => {
  assert.deepEqual(keyEventOf('ArrowUp'), { key: 'ArrowUp', code: 'ArrowUp' });
  assert.deepEqual(keyEventOf('KeyW'), { key: 'w', code: 'KeyW' });
  assert.deepEqual(keyEventOf('Digit2'), { key: '2', code: 'Digit2' });
  assert.deepEqual(keyEventOf('Space'), { key: ' ', code: 'Space' });
});

test('a held arrow presses a game axis bound to it by code', () => {
  const steer = defineInput({ id: 'steer', label: 'Steer', axis: { negative: { keys: ['code:ArrowLeft', 'code:KeyA'], pad: ['ls-left'] }, positive: { keys: ['code:ArrowRight', 'code:KeyD'], pad: ['ls-right'] } } });
  assert.equal(gameActionsPressedBy(rows(steer), 'ArrowLeft').length, 1);
  assert.deepEqual(gameActionsPressedBy(rows(steer), 'ArrowUp'), []);
});

test('arrows press nothing in a game that binds only Enter, Space and Escape; engine rows never count', () => {
  const next = defineInput({ id: 'next', label: 'Next', keys: ['Enter', 'Space'], pad: ['a'] });
  const r = rows(next);
  assert.deepEqual(gameActionsPressedBy(r, 'ArrowUp'), []);
  assert.deepEqual(gameActionsPressedBy(r, 'ArrowLeft'), []);
  assert.deepEqual(gameActionsPressedBy(r, 'Escape'), [], 'core Back is the engine\'s, not the game\'s');
  assert.equal(gameActionsPressedBy(r, 'Space').length, 1);
  assert.equal(gameActionsPressedBy(r, 'Enter').length, 1);
});

test('a letter key matches both a key chord and a code chord', () => {
  assert.equal(gameActionsPressedBy(rows(defineInput({ id: 'act', label: 'Act', keys: ['code:KeyE'], pad: ['a'] })), 'KeyE').length, 1);
  assert.equal(gameActionsPressedBy(rows(defineInput({ id: 'act', label: 'Act', keys: ['e'], pad: ['a'] })), 'KeyE').length, 1);
});
