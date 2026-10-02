import test from 'node:test';
import assert from 'node:assert/strict';
import {listenHost} from './lib.mjs';

test('npm run play listens on 127.0.0.1 unless --host or ENGINE_HOST asks for the network', () => {
  assert.equal(listenHost([], {}), '127.0.0.1');
  assert.equal(listenHost(['--game', 'templates/arcade/game'], {}), '127.0.0.1');
  assert.equal(listenHost(['--host'], {}), true, 'every interface');
  assert.equal(listenHost(['--host', '--game', 'x'], {}), true, 'a following flag is not an address');
  assert.equal(listenHost(['--host', '192.168.1.5'], {}), '192.168.1.5');
  assert.equal(listenHost(['--host=0.0.0.0'], {}), '0.0.0.0');
  for (const on of ['1', 'true']) assert.equal(listenHost([], {ENGINE_HOST: on}), true);
  for (const off of ['', '0', 'false']) assert.equal(listenHost([], {ENGINE_HOST: off}), '127.0.0.1');
  assert.equal(listenHost(['--host', '10.0.0.2'], {ENGINE_HOST: '0'}), '10.0.0.2', 'the flag wins over the environment');
});
