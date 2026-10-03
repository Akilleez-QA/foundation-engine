// NW-07 fast checks (no sockets, no hosts): configuration caps and the invariant classification.
// The host-driving regression is tools/network-probe/probe.regression.mjs, run once in CI by
// `npm run test:network-probe`, not by every per-template `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveConfig, invariants, CAPS} from './probe.mjs';

test('NW07: probe configuration is capped and validated', () => {
  assert.throws(() => resolveConfig({overload: {healthyClients: CAPS.healthyClients + 1}}), RangeError);
  assert.throws(() => resolveConfig({overload: {rampPerClient: [CAPS.ratePerClient + 1]}}), RangeError);
  assert.throws(() => resolveConfig({overload: {queueAgeVariants: [0]}}), RangeError);
  assert.throws(
    () => resolveConfig({storm: {variants: [{policy: 'jitter', clients: CAPS.stormClients + 1}]}}),
    RangeError,
  );
  assert.throws(() => resolveConfig({storm: {variants: [{policy: 'other', clients: 2}]}}), RangeError);
  assert.throws(() => resolveConfig({nonReader: {maxAttackMs: CAPS.attackMs + 1}}), RangeError);
  assert.throws(() => resolveConfig({abort: {rssMb: CAPS.rssMb + 1}}), RangeError);
  assert.throws(() => resolveConfig({scenarios: ['unknown']}), RangeError);
  assert.throws(() => resolveConfig({storm: {observeMs: 7000}}), /worst-case episode backoff 7750/);
  const c = resolveConfig();
  assert.equal(c.seed, 7);
  assert.deepEqual(c.scenarios, ['overload', 'non-reader', 'storm']);
});

const stormVariant = over => ({
  policy: 'jitter',
  clients: 8,
  hostConnectionBound: 8,
  hostReadyAfterMs: 700,
  attempts: 20,
  maxAttemptsPerClient: 4,
  attemptBoundPerClient: 6,
  retryBudgetBoundPerClient: 8,
  hostConnectionsAtEnd: 8,
  closesDuringStorm: {1006: 12},
  outcomes: {reconnected: 8, exhausted: 0, 'budget-empty': 0, terminal: 0, unresolved: 0},
  attemptedAfterReady: 5,
  attemptedAfterReadyReconnected: 5,
  stoppedBeforeReady: 0,
  ...over,
});
const failing = variant =>
  invariants({config: {abort: {rssMb: 1024}}, scenarios: {storm: {variants: [variant]}}})
    .filter(r => r.ok === false)
    .map(r => r.id.split('.').at(-1));

test('NW07: storm invariants reject terminal, stuck, capacity-refused and missed reconnects', () => {
  assert.deepEqual(failing(stormVariant({})), []);
  assert.deepEqual(
    failing(stormVariant({outcomes: {reconnected: 7, exhausted: 0, 'budget-empty': 0, terminal: 1, unresolved: 0}})),
    ['no-terminal-or-stuck-client', 'retrying-clients-reconnect'],
  );
  assert.deepEqual(failing(stormVariant({closesDuringStorm: {'1013 connection-capacity': 1}})), [
    'no-capacity-refusal',
  ]);
  assert.deepEqual(
    failing(
      stormVariant({
        attemptedAfterReadyReconnected: 4,
        outcomes: {reconnected: 7, exhausted: 1, 'budget-empty': 0, terminal: 0, unresolved: 0},
      }),
    ),
    ['retrying-clients-reconnect'],
  );
  assert.deepEqual(failing(stormVariant({maxAttemptsPerClient: 7})), ['attempts-bounded']);
  // Over the connection bound, capacity refusals are expected and not every client can reconnect.
  assert.deepEqual(
    failing(
      stormVariant({
        clients: 16,
        closesDuringStorm: {'1013 connection-capacity': 20},
        outcomes: {reconnected: 8, exhausted: 8, 'budget-empty': 0, terminal: 0, unresolved: 0},
      }),
    ),
    [],
  );
});
