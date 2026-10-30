import test from 'node:test';
import assert from 'node:assert/strict';
import {isLoopback, listenHost, serve} from './lib.mjs';

test('npm run play listens on 127.0.0.1 unless --host or ENGINE_HOST asks for the network', () => {
  assert.equal(listenHost([], {}), '127.0.0.1');
  assert.equal(listenHost(['--game', 'templates/arcade/game'], {}), '127.0.0.1');
  assert.equal(listenHost(['--host'], {}), true, 'every interface');
  assert.equal(listenHost(['--host', '--game', 'x'], {}), true, 'a following flag is not an address');
  assert.equal(listenHost(['--host', '192.168.1.5'], {}), '192.168.1.5');
  assert.equal(listenHost(['--host=0.0.0.0'], {}), '0.0.0.0');
  for (const on of ['1', 'true']) assert.equal(listenHost([], {ENGINE_HOST: on}), true);
  for (const off of ['', '0', 'false']) assert.equal(listenHost([], {ENGINE_HOST: off}), '127.0.0.1');
  assert.equal(
    listenHost(['--host', '10.0.0.2'], {ENGINE_HOST: '0'}),
    '10.0.0.2',
    'the flag wins over the environment',
  );
});

test('isLoopback: only addresses this machine alone can reach', () => {
  for (const h of ['127.0.0.1', '127.0.0.2', 'localhost', '::1']) assert.equal(isLoopback(h), true, h);
  for (const h of [true, '0.0.0.0', '192.168.1.5', '::']) assert.equal(isLoopback(h), false, String(h));
});

test(
  'serve() on a specific address that Vite lists only as a network URL returns that URL',
  {skip: process.platform !== 'linux' && 'needs the whole 127/8 loopback range (Linux)'},
  async () => {
    const server = await serve({host: '127.0.0.2'});
    try {
      assert.match(server.url, /^http:\/\/127\.0\.0\.2:\d+$/);
      assert.ok(server.network.includes(server.url));
      assert.equal((await fetch(server.url + '/')).status, 200);
    } finally {
      await server.close();
    }
  },
);
