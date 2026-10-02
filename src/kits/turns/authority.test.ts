import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthorityGenesis, createDurableAuthority, type AuthorityStorage } from '../network';
import { createTurnLog, turnAuthorityPolicies } from './index';
import { cardRules, table, type Move } from './test-rules';

const json = { maxBytes: 65536, maxNodes: 4096, maxDepth: 12 };
const limits = { envelope: json, state: json, input: json, result: json, maxStreams: 2, maxReceiptsPerStream: 4 };

function memory(raw: string): AuthorityStorage & { raw: string } {
  const s = {
    raw,
    async settle() {},
    async read() { return s.raw; },
    async compareAndSwap(q: { lineage: string; schema: string; revision: number; json: string }) {
      const old = JSON.parse(s.raw);
      if (old.lineage !== q.lineage || old.schema !== q.schema || old.revision !== q.revision) return 'rejected' as const;
      s.raw = q.json; return 'committed' as const;
    },
  };
  return s;
}

test('the same rules run under the durable authority: rejections are consumed, recovery reproduces state', async () => {
  const rules = cardRules(), policies = turnAuthorityPolicies(rules, { seed: 7 });
  const config = { lineage: 'match-1', schema: rules.id, limits, ...policies };
  const storage = memory(createAuthorityGenesis({ ...config, stateJson: JSON.stringify(table) }));
  const owner = createDurableAuthority({ ...config, storage, authorize: () => true });
  assert.equal((await owner.recover()).status, 'recovered');
  const submit = (sequence: number, move: Move) => owner.submit({ stream: 'p1', sequence, inputJson: JSON.stringify(move) });
  const shuffled = await submit(1, { type: 'shuffle' });
  assert.equal(shuffled.status, 'committed');
  assert.deepEqual(shuffled.status === 'committed' && shuffled.result, { accepted: true });
  const rejected = await submit(2, { type: 'play', card: 1 });
  assert.deepEqual(rejected.status === 'committed' && rejected.result, { accepted: false, reason: 'card not in hand' });
  // A retried duplicate does not re-run the rules.
  assert.equal((await submit(1, { type: 'shuffle' })).status, 'duplicate');
  assert.equal((await submit(3, { type: 'teleport' } as unknown as Move)).status, 'refused');
  const state = owner.read().snapshot!.envelope.state;
  const again = createDurableAuthority({ ...config, storage, authorize: () => true });
  assert.equal((await again.recover()).status, 'recovered');
  assert.deepEqual(again.read().snapshot!.envelope.state, state);
  // Same seed, stream and sequence: a second authority reproduces the same shuffle.
  const fresh = memory(createAuthorityGenesis({ ...config, stateJson: JSON.stringify(table) }));
  const other = createDurableAuthority({ ...config, storage: fresh, authorize: () => true });
  await other.recover();
  await other.submit({ stream: 'p1', sequence: 1, inputJson: JSON.stringify({ type: 'shuffle' }) });
  assert.deepEqual(other.read().snapshot!.envelope.state, state);
  // Deterministic rules without randomness reach the same state as the local log.
  const local = createTurnLog({ rules, limits: { maxCommands: 4, state: json, command: json }, seed: 7, initial: table });
  local.submit(0, { type: 'draw' });
  await other.submit({ stream: 'p1', sequence: 2, inputJson: JSON.stringify({ type: 'draw' }) });
  const viaLog = createTurnLog({ rules, limits: { maxCommands: 4, state: json, command: json }, seed: 7, initial: other.read().snapshot!.envelope.state as typeof table });
  assert.equal(viaLog.read().state.hand.length, 1);
  assert.equal(local.read().state.hand.length, 1);
  owner.dispose(); again.dispose(); other.dispose();
});

test('authority policies reject an invalid seed and malformed results', () => {
  assert.throws(() => turnAuthorityPolicies(cardRules(), { seed: -1 }));
  const p = turnAuthorityPolicies(cardRules(), { seed: 1 });
  assert.equal(p.validateResult({ accepted: true }), true);
  assert.equal(p.validateResult({ accepted: true, extra: 1 }), false);
  assert.equal(p.validateResult({ accepted: false }), false);
  assert.equal(p.validateResult([]), false);
});
