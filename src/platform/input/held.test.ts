import test from 'node:test';
import assert from 'node:assert/strict';
import {AliasHeldInput} from './held';

test('held-key repeats cannot re-arm after blur, hidden, dialog or route clearing', () => {
  for (const transition of ['blur', 'hidden', 'dialog entry', 'dialog exit', 'route exit']) {
    const input = new AliasHeldInput();
    input.press('key:KeyW', 'up');
    assert.ok(input.has('up'));
    input.clear();
    input.press('key:KeyW', 'up', true);
    assert.equal(input.has('up'), false, transition);
    input.release('key:KeyW');
    input.press('key:KeyW', 'up');
    assert.ok(input.has('up'));
  }
});
test('releasing one keyboard alias or touch pointer preserves other held owners', () => {
  const input = new AliasHeldInput();
  input.press('key:KeyW', 'up');
  input.press('key:ArrowUp', 'up');
  input.press('pointer:4', 'up');
  input.release('key:KeyW');
  assert.ok(input.has('up'));
  input.release('pointer:4');
  assert.ok(input.has('up'));
  input.release('key:ArrowUp');
  assert.equal(input.has('up'), false);
});
test('quick jump survives release until consumed but does not survive lifecycle clear', () => {
  const input = new AliasHeldInput();
  input.press('pad:jumpSpace', 'jump');
  input.release('pad:jumpSpace');
  assert.ok(input.consumeJump());
  assert.equal(input.consumeJump(), false);
  input.press('key:Space', 'jump');
  input.clear();
  assert.equal(input.consumeJump(), false);
  assert.equal(input.has('jump'), false);
  input.press('key:Space', 'jump', true);
  assert.equal(input.consumeJump(), false);
});
test('moving consumes a held jump without repeat rearming; a vehicle can retain held brake', () => {
  const input = new AliasHeldInput();
  input.press('key:Space', 'jump');
  assert.ok(input.has('jump'));
  input.consumeJump();
  input.delete('jump');
  input.press('key:Space', 'jump', true);
  assert.equal(input.has('jump'), false);
  input.release('key:Space');
  input.press('key:Space', 'jump');
  assert.ok(input.has('jump'));
});
