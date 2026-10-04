import test from 'node:test';
import assert from 'node:assert/strict';
import {check, hits} from './genericity.mjs';

test('genericity: core, platform, author and the engine docs carry no genre vocabulary', () => {
  assert.deepEqual(
    check().map(h => `${h.file}:${h.line} ${h.word}`),
    [],
  );
});

test('genericity: genre words are caught; idioms and the opt-in audience flag are allowed', () => {
  assert.equal(hits('the player walks to the station').length, 2);
  assert.equal(hits('Enter the room and collect a badge').length, 2);
  assert.equal(hits('values are compared in place').length, 0);
  assert.equal(hits('gaps leave room for new rows').length, 0);
  assert.equal(hits('`kids: true` opts in to the kid-safe profile').length, 0);
  assert.equal(hits('a walk cycle breaks into key poses; the `walk` clip loops').length, 0);
  assert.equal(hits('the hero walks to the next room').length, 2);
});
