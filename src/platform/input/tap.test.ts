import test from 'node:test';
import assert from 'node:assert/strict';
import {WORLD_TAP_SLOP, blockContextMenu, pressReleased, primaryPress, withinTap} from './tap';
test('only the primary button (mouse left, touch contact, pen tip) starts world input', () => {
  assert.equal(primaryPress({button: 0}), true);
  for (const button of [1, 2, 3, 4, 5]) assert.equal(primaryPress({button}), false, `button ${button}`);
});
test('world taps allow the shared 12 px of travel, inclusive, and never without a start', () => {
  assert.equal(WORLD_TAP_SLOP, 12);
  assert.equal(withinTap({x: 100, y: 100}, {clientX: 112, clientY: 100}), true);
  assert.equal(withinTap({x: 100, y: 100}, {clientX: 109, clientY: 109}), false);
  assert.equal(withinTap(null, {clientX: 0, clientY: 0}), false);
  assert.equal(withinTap({x: 0, y: 0}, {clientX: 7, clientY: 0}, 6), false);
});
test('a move with no held buttons means the release went unheard', () => {
  assert.equal(pressReleased({buttons: 0}), true);
  assert.equal(pressReleased({buttons: 1}), false);
  assert.equal(pressReleased({buttons: 2}), false);
});
test('the context menu is suppressed through the handler property that releaseCanvasHandlers clears', () => {
  const element = {oncontextmenu: null as null | ((e: {preventDefault(): void}) => void)};
  let prevented = 0;
  blockContextMenu(element as unknown as HTMLElement);
  element.oncontextmenu!({preventDefault: () => prevented++});
  assert.equal(prevented, 1);
});
