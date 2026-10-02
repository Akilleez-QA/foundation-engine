import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthorityGenesis, createDurableAuthority, createPrediction, type AuthorityStorage } from '../network';
import type { DocumentValue } from '../authoring/document';
import { checkPredictionAgreement } from './agreement';

const json = { maxBytes: 4096, maxNodes: 64, maxDepth: 4 };
type State = { readonly x: number; readonly y: number };
const isState = (v: DocumentValue) => !!v && typeof v === 'object' && !Array.isArray(v) && Number.isSafeInteger((v as State).x) && Number.isSafeInteger((v as State).y);
const isMove = (v: DocumentValue) => !!v && typeof v === 'object' && !Array.isArray(v) && Number.isSafeInteger((v as State).x) && Number.isSafeInteger((v as State).y);
/** The shared rule both sides are meant to run: move, clamped to a 10 x 10 board. */
const clamp = (n: number) => Math.max(0, Math.min(9, n));
const move = (s: State, m: State): State => ({ x: clamp(s.x + m.x), y: clamp(s.y + m.y) });

async function fixture(hostRule: (s: State, m: State) => State, clientRule: (s: State, m: State) => State = move, authorize = () => true) {
  const config = { lineage: 'agreement-world', schema: 'board-v1', validateState: isState, validateInput: isMove, validateResult: () => true,
    limits: { envelope: { maxBytes: 65536, maxNodes: 4096, maxDepth: 8 }, state: json, input: json, result: json, maxStreams: 2, maxReceiptsPerStream: 4 } };
  let raw: string | null = createAuthorityGenesis({ ...config, stateJson: '{"x":0,"y":0}' });
  const storage: AuthorityStorage = {
    async settle() {}, async read() { return raw; },
    async compareAndSwap(q) { const old = JSON.parse(raw!); if (old.revision !== q.revision) return 'rejected'; raw = q.json; return 'committed'; },
  };
  const host = createDurableAuthority({ ...config, storage, authorize,
    reduce: ({ state, input }) => { const next = hostRule(state as State, input as State); return { stateJson: JSON.stringify(next), resultJson: '"ok"' }; } });
  assert.equal((await host.recover()).status, 'recovered');
  const prediction = createPrediction({ epoch: 'pilot-1', baseline: { revision: 0, processedThrough: 0, stateJson: '{"x":0,"y":0}' },
    limits: { state: json, input: json, maxPending: 4, maxPendingBytes: 1024, maxReplaySteps: 8 },
    validateState: isState, validateInput: isMove, reduce: (s, m) => JSON.stringify(clientRule(s as State, m as State)) });
  return { host, prediction };
}
const inputs = ['{"x":3,"y":1}', '{"x":4,"y":4}', '{"x":5,"y":0}', '{"x":-2,"y":7}', '{"x":0,"y":-12}', '{"x":1,"y":1}'];

test('SIM-01 agreement: client prediction and host reduction agree on the same command prefix', async () => {
  const { host, prediction } = await fixture(move);
  const r = await checkPredictionAgreement({ prediction, epoch: 'pilot-1', host, stream: 'pilot', inputs, maxInputs: 16, state: json });
  assert.equal(r.status, 'agree');
  assert.equal(r.through, 6);
  assert.deepEqual(r.comparison, { status: 'equal', from: 1, through: 6, samples: 6 });
  assert.equal(r.corrections, 0, 'agreeing reducers never correct');
  assert.equal(prediction.read().pending.length, 0);
  assert.deepEqual(host.read().snapshot?.envelope.state, { x: 8, y: 1 });
});

test('SIM-01 agreement: a host rule the client does not share is reported at its first sequence', async () => {
  // The host forgot the clamp: the third command (x 7+5) is the first one where the rules give different states.
  const { host, prediction } = await fixture((s, m) => ({ x: s.x + m.x, y: s.y + m.y }));
  const r = await checkPredictionAgreement({ prediction, epoch: 'pilot-1', host, stream: 'pilot', inputs, maxInputs: 16, state: json, detailChars: 4096 });
  assert.equal(r.status, 'diverged');
  const c = r.comparison!;
  assert.equal(c.status, 'diverged');
  if (c.status !== 'diverged') return;
  assert.equal(c.tick, 3);
  assert.equal(c.exact, true);
  assert.deepEqual([JSON.parse(c.detail.a!), JSON.parse(c.detail.b!)], [{ x: 9, y: 5 }, { x: 12, y: 5 }]);
  assert.ok(r.corrections >= 1, 'the divergence also shows up as a visible correction');
});

test('SIM-01 agreement: a refused command stops the check without claiming agreement', async () => {
  let allowed = 2;   // authorization is checked twice per command (admission and before storage)
  const { host, prediction } = await fixture(move, move, () => allowed-- > 0);
  const r = await checkPredictionAgreement({ prediction, epoch: 'pilot-1', host, stream: 'pilot', inputs, maxInputs: 16, state: json });
  assert.equal(r.status, 'refused');
  assert.equal(r.refusal?.side, 'host');
  assert.equal(r.refusal?.sequence, 2);
  assert.equal(r.through, 1);
  await assert.rejects(checkPredictionAgreement({ prediction, epoch: 'pilot-1', host, stream: 'pilot', inputs, maxInputs: 3, state: json }), /maxInputs/);
  await assert.rejects(checkPredictionAgreement({ prediction, epoch: 'pilot-1', host, stream: 'pilot', inputs: [], maxInputs: 3, state: json }), /at least one/);
});
