import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MemoryBackend} from './storage-port';
import {createSaveStore} from './store';
import type {SaveSection} from './section';
import {createSaveTestAdapter} from './test-adapter';

const tickets: SaveSection<{n: number}> = {
  id: 'wallet.tickets',
  scope: 'player',
  version: 1,
  aliases: ['wallet.old'],
  initial: () => ({n: 0}),
  parse: raw => ({n: Number((raw as {n?: unknown} | null)?.n ?? 0)}),
  legacy: {
    mode: 'live',
    fromVersion: 1,
    keys: p => ['game-tickets-' + p],
    decode: ([r]) => (r === null ? {n: 0} : JSON.parse(r!)) /* one raw per key; one key */,
    encode: v => [JSON.stringify(v)],
  },
};
const device: SaveSection<string> = {
  id: 'graphics.pick',
  scope: 'device',
  version: 1,
  initial: () => 'auto',
  parse: raw => String(raw ?? 'auto'),
};

function setup() {
  const backend = new MemoryBackend(),
    local = backend.port(0);
  const store = createSaveStore({
    local,
    session: new MemoryBackend().port(0, 'session'),
    build: 'game@test',
    sections: [tickets, device],
  });
  let heard: unknown = null;
  store.section(tickets).subscribe(v => {
    heard = v;
  });
  return {store, local, heard: () => heard, api: createSaveTestAdapter(store, [tickets, device])};
}

test('engine.save.seed writes a running store through the section: subscribers hear it and the legacy key is written now', () => {
  const {store, local, heard, api} = setup();
  assert.deepEqual(api.sections(), ['wallet.tickets', 'graphics.pick']);
  assert.equal(api.seed('wallet.tickets', {n: 7}), 'saved');
  assert.deepEqual(heard(), {n: 7});
  assert.equal(local.get('game-tickets-' + store.activePlayer()), '{"n":7}');
  assert.deepEqual(api.read('wallet.tickets'), {n: 7});
});

test('a section is found by id, alias or legacy key; another player is addressed explicitly; an unknown name throws', () => {
  const {store, local, api} = setup();
  const other = store.addPlayer('Two');
  api.seed('game-tickets-' + other, {n: 3}, other);
  api.seed('wallet.old', {n: 1});
  assert.equal(local.get('game-tickets-' + other), '{"n":3}');
  assert.deepEqual(api.read('wallet.tickets', other), {n: 3});
  assert.deepEqual(api.read('wallet.tickets'), {n: 1});
  api.seed('graphics.pick', 'low', other); // device scope ignores the player
  assert.equal(api.read('graphics.pick'), 'low');
  assert.throws(() => api.read('game-nope'), /no section 'game-nope'/);
});
