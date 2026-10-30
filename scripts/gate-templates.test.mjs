import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {discoverTemplates, selectTemplates, runTemplates} from './gate-templates.mjs';

const shard = (names, n) => selectTemplates(names, ['--shard', `${n}/2`, '--phone']).names;
test('sorted shard union covers each discovered template exactly once, including additions and odd counts', () => {
  const root = mkdtempSync(join(tmpdir(), 'template-shards-'));
  try {
    mkdirSync(join(root, 'templates'));
    assert.throws(() => discoverTemplates(root), /no templates/);
    for (const name of ['z', 'b', 'a', 'new', 'last']) {
      const game = join(root, 'templates', name, 'game');
      mkdirSync(game, {recursive: true});
      writeFileSync(join(game, 'game.ts'), '');
      const all = discoverTemplates(root);
      if (all.length < 2) {
        assert.throws(() => shard(all, 2), /empty/);
        continue;
      }
      const left = shard(all, 1),
        right = shard(all, 2);
      assert.deepEqual([...left, ...right].sort(), all);
      assert.equal(new Set([...left, ...right]).size, all.length);
      assert.equal(
        left.some(name => right.includes(name)),
        false,
      );
    }
    mkdirSync(join(root, 'templates', 'broken', 'game'), {recursive: true});
    assert.throws(() => discoverTemplates(root), /missing game/);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
test('selection rejects malformed, unknown, empty, repeated and mixed filters before execution', () => {
  for (const args of [
    ['missing'],
    ['--wat'],
    ['--shard'],
    ['--shard', '0/2'],
    ['--shard', '3/2'],
    ['--shard', '1/0'],
    ['--shard', '1/2x'],
    ['--shard', '1/2', 'a'],
    ['--shard', '1/2', '--shard', '2/2'],
    ['--phone', '--phone'],
  ])
    assert.throws(() => selectTemplates(['a', 'b'], args));
  assert.throws(() => selectTemplates([], []), /empty/);
  assert.deepEqual(selectTemplates(['b', 'a'], ['b', 'b']).names, ['b']);
});
test('every selected template gets the complete gate and phone smoke; failures propagate', () => {
  const calls = [];
  const run = status =>
    runTemplates(
      {names: ['a', 'b'], phone: true},
      {
        log: () => {},
        spawn: (cmd, args, opts) => {
          calls.push({args, game: opts.env.GAME_DIR});
          return {status: status(calls.length)};
        },
      },
    );
  assert.equal(
    run(() => 0),
    0,
  );
  assert.deepEqual(
    calls.map(c => c.game),
    ['templates/a/game', 'templates/a/game', 'templates/b/game', 'templates/b/game'],
  );
  assert.deepEqual(
    calls.map(c => c.args.slice(-3)),
    [
      ['run', '-s', 'gate'],
      ['play:snap', '--', '--mobile'],
      ['run', '-s', 'gate'],
      ['play:snap', '--', '--mobile'],
    ],
  );
  calls.length = 0;
  assert.equal(
    run(n => (n === 2 ? 1 : 0)),
    1,
  );
  assert.equal(calls.length, 2);
  calls.length = 0;
  assert.equal(
    run(() => null),
    1,
  );
  assert.equal(calls.length, 1);
});
