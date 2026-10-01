import test from 'node:test';
import assert from 'node:assert/strict';
import {affectedTests} from './check.mjs';

test('check: a changed file brings its own test, its game\'s tests, or its folder\'s tests', () => {
  assert.deepEqual(affectedTests(['src/kits/ui/index.ts'], 'templates/blank/game'), ['src/kits/ui/ui.test.ts']);
  const game = affectedTests(['templates/arcade/game/steer.ts'], 'templates/arcade/game');
  assert.ok(game.includes('templates/arcade/game/play.test.ts') && game.includes('src/app/templates.test.ts'));
  assert.deepEqual(affectedTests(['docs/STANDARD.md'], 'templates/blank/game'), []);
  assert.ok(affectedTests(['src/core/ecs/world.ts'], 'templates/blank/game').includes('src/core/ecs/ecs.test.ts'));
});
