import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RequestLedger, isLocal} from './network.mjs';

const req = (requestId, url, type = 'Script') => ({requestId, type, request: {url}});

test('the ledger counts requests, bytes and what is still in flight', () => {
  const l = new RequestLedger();
  l.request(req('1', 'http://127.0.0.1:4000/a.js'));
  l.request(req('2', 'http://127.0.0.1:4000/b.png', 'Image'));
  l.request(req('3', 'data:image/png;base64,xx'));
  l.request(req('4', 'ws://127.0.0.1:4000/live', 'WebSocket'));
  assert.equal(l.snapshot().pending, 2, 'inline data and streams never count as loading');
  l.finish({requestId: '1', encodedDataLength: 1000});
  l.finish({requestId: '2'}, true);
  assert.deepEqual({...l.snapshot(), revision: 0}, {requests: 2, bytes: 1000, failures: 1, pending: 0, revision: 0, urls: []});
  l.request(req('5', 'http://127.0.0.1:4000/a.js')); l.request(req('5', 'http://127.0.0.1:4000/a.js'));
  assert.equal(l.snapshot().requests, 3, 'a redirect of the same request counts once');
});

test('only the served origin and inline data are local', () => {
  assert.ok(isLocal('http://127.0.0.1:4000/x', 'http://127.0.0.1:4000'));
  assert.ok(isLocal('blob:http://127.0.0.1:4000/1', 'http://127.0.0.1:4000'));
  assert.ok(!isLocal('https://example.com/font.woff2', 'http://127.0.0.1:4000'));
  assert.ok(!isLocal('not a url', 'http://127.0.0.1:4000'));
});
