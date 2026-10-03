import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createClosePolicy,
  DEFAULT_TERMINAL_CLOSE_CODES,
  DEFAULT_TERMINAL_CLOSE_REASONS,
  MAX_CLOSE_POLICY_ENTRIES,
} from './index.ts';
import {parseRemoteClose} from '../../platform/network/browser-transport.ts';

test('default policy: credential refusals and RFC 6455 protocol violations are terminal; everything else is transient', () => {
  const policy = createClosePolicy();
  assert.deepEqual(policy.read(), {
    terminalReasons: DEFAULT_TERMINAL_CLOSE_REASONS,
    terminalCodes: DEFAULT_TERMINAL_CLOSE_CODES,
  });
  assert.equal(policy.classify({code: 1008, reason: 'auth-rejected'}), 'terminal');
  assert.equal(policy.classify({code: null, reason: 'revoked'}), 'terminal');
  for (const code of [1002, 1003, 1007]) assert.equal(policy.classify({code, reason: null}), 'terminal');
  for (const remote of [
    {code: 1008, reason: 'send-refused'},
    {code: 1013, reason: 'connection-capacity'},
    {code: 1008, reason: 'auth-timeout'},
    {code: 1006, reason: null},
    {code: 1000, reason: null},
    {code: null, reason: null},
    null,
    undefined,
  ])
    assert.equal(policy.classify(remote), 'transient', JSON.stringify(remote));
});

test('the creator chooses terminal reasons and codes; [] means none and omitted means the default', () => {
  const none = createClosePolicy({terminalReasons: [], terminalCodes: []});
  assert.equal(none.classify({code: 1002, reason: 'auth-rejected'}), 'transient');
  const custom = createClosePolicy({terminalReasons: ['banned'], terminalCodes: [4401]});
  assert.equal(custom.classify({code: 1008, reason: 'banned'}), 'terminal');
  assert.equal(custom.classify({code: 4401, reason: null}), 'terminal');
  assert.equal(custom.classify({code: 1008, reason: 'auth-rejected'}), 'transient');
  const reasonsOnly = createClosePolicy({terminalReasons: ['x']});
  assert.deepEqual(reasonsOnly.read().terminalCodes, DEFAULT_TERMINAL_CLOSE_CODES);
});

test('options are validated, bounded and captured', () => {
  const reasons = ['a'];
  const policy = createClosePolicy({terminalReasons: reasons});
  reasons.push('b');
  assert.equal(policy.classify({code: null, reason: 'b'}), 'transient');
  assert.ok(Object.isFrozen(policy.read()) && Object.isFrozen(policy.read().terminalReasons));
  const tooMany = Array.from({length: MAX_CLOSE_POLICY_ENTRIES + 1}, (_, i) => `r${i}`);
  for (const options of [
    {terminalReasons: tooMany},
    {terminalReasons: ['a', 'a']},
    {terminalReasons: ['has space']},
    {terminalReasons: ['x'.repeat(65)]},
    {terminalReasons: ['']},
    {terminalReasons: 'auth-rejected'},
    {terminalCodes: [999]},
    {terminalCodes: [5000]},
    {terminalCodes: [1008.5]},
    {terminalCodes: ['1008']},
    {terminalCodes: [1002, 1002]},
    {terminalCode: [1002]},
    null,
    [],
  ])
    assert.throws(() => createClosePolicy(options as never), /close policy/, JSON.stringify(options));
});

test('classification consumes only validated parse output: a hostile reason cannot match a terminal token', () => {
  const policy = createClosePolicy({terminalReasons: ['auth-rejected'], terminalCodes: []});
  assert.equal(policy.classify(parseRemoteClose({code: 1008, reason: 'auth-rejected'})), 'terminal');
  for (const reason of ['auth-rejected ', '<auth-rejected>', `auth-rejected${'x'.repeat(200)}`])
    assert.equal(policy.classify(parseRemoteClose({code: 1008, reason})), 'transient');
  // A forged record that bypassed parsing is still checked before matching.
  assert.equal(policy.classify({code: 1008.5, reason: 'nope nope'} as never), 'transient');
});
