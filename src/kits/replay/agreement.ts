/**
 * kits/replay/agreement.ts: does client prediction agree with host reduction on the same command prefix?
 *
 * Drives the network kit's existing owners, not a second simulation: each command is pushed once to the caller's
 * `Prediction`, the exact captured input (sequence and canonical JSON) is submitted to the caller's durable authority,
 * and the predicted state after sequence k is digested beside the authority's committed state after sequence k. The
 * prediction is then reconciled to that authoritative baseline, so every comparison starts from the same state and
 * the first differing sequence is where the two reducers disagree. The comparator is the replay kit's digest
 * comparator, with the command sequence as the tick.
 */
import type {AuthorityCommand, AuthorityOutcome, AuthoritySnapshot, AuthorityStatus} from '../network/authority-types';
import type {JsonLimits} from '../network/captured-json';
import type {Prediction} from '../network/prediction-types';
import {compareDigests, createDigestTrace, type DigestComparison, type DigestSnapshot} from './digest';
import {digestJson} from './hash';

/** The durable authority surface this check uses (createDurableAuthority satisfies it). */
export interface AgreementHost {
  submit(command: AuthorityCommand): Promise<AuthorityOutcome>;
  read(): Readonly<{status: AuthorityStatus; snapshot: AuthoritySnapshot | null}>;
}
export interface AgreementOptions {
  /** A ready prediction owner whose baseline is the host's current committed state for `stream`. */
  readonly prediction: Prediction;
  /** The prediction owner's trusted control epoch (used for reconciliation). */
  readonly epoch: string;
  /** A recovered (ready) authority. */
  readonly host: AgreementHost;
  readonly stream: string;
  /** The command prefix, as already codec-normalised JSON. */
  readonly inputs: readonly string[];
  /** Most commands one check may drive. */
  readonly maxInputs: number;
  /** Bounds for canonicalising each state before digesting. */
  readonly state: JsonLimits;
  /** Keep the predicted and authoritative state text for the first `detailChars` characters of states (default 0). */
  readonly detailChars?: number;
}
export type AgreementReport = Readonly<{
  status: 'agree' | 'diverged' | 'refused';
  /** Commands driven through both sides. */
  through: number;
  /** Which side refused and why (status 'refused'). */
  refusal: Readonly<{side: 'client' | 'host'; sequence: number; reason: string}> | null;
  comparison: DigestComparison | null;
  /** Reconciliations that changed the prediction (a visible correction). */
  corrections: number;
  client: DigestSnapshot;
  host: DigestSnapshot;
}>;

/** Bounded by `maxInputs` commands; each side's own limits still apply. Owners stay caller-owned (not disposed). */
export async function checkPredictionAgreement(o: AgreementOptions): Promise<AgreementReport> {
  if (!Number.isSafeInteger(o.maxInputs) || o.maxInputs <= 0)
    throw Error('replay agreement: maxInputs must be a positive safe integer');
  if (o.inputs.length === 0) throw Error('replay agreement: give at least one input');
  if (o.inputs.length > o.maxInputs)
    throw Error(`replay agreement: ${o.inputs.length} inputs exceed maxInputs ${o.maxInputs}`);
  const identity = `agreement:${o.stream}`,
    detailChars = o.detailChars ?? 0;
  const traceOptions = {
    identity,
    every: 1,
    maxEntries: o.maxInputs,
    maxDigestLength: 64,
    ...(detailChars > 0 ? {detail: {from: 0, to: Number.MAX_SAFE_INTEGER, maxChars: detailChars}} : {}),
  };
  const client = createDigestTrace(traceOptions),
    host = createDigestTrace(traceOptions);
  let through = 0,
    corrections = 0,
    refusal: AgreementReport['refusal'] = null;
  for (const inputJson of o.inputs) {
    const pushed = o.prediction.push(inputJson);
    if (pushed.status !== 'predicted') {
      refusal = {side: 'client', sequence: through + 1, reason: o.prediction.read().reason ?? pushed.status};
      break;
    }
    const sequence = pushed.input.sequence,
      predicted = o.prediction.read().predicted!.json;
    const outcome = await o.host.submit({stream: o.stream, sequence, inputJson: pushed.input.json});
    if (outcome.status !== 'committed') {
      refusal = {
        side: 'host',
        sequence,
        reason: 'reason' in outcome ? `${outcome.status}:${outcome.reason}` : outcome.status,
      };
      break;
    }
    const snapshot = o.host.read().snapshot;
    if (!snapshot) {
      refusal = {side: 'host', sequence, reason: 'not-ready'};
      break;
    }
    const stateJson = JSON.stringify(snapshot.envelope.state);
    const processedThrough = snapshot.envelope.streams.find(s => s.id === o.stream)?.through ?? 0;
    client.observe(
      sequence,
      () => digestJson(predicted, o.state),
      () => predicted,
    );
    host.observe(
      sequence,
      () => digestJson(stateJson, o.state),
      () => stateJson,
    );
    const reconciled = o.prediction.reconcile({
      epoch: o.epoch,
      revision: snapshot.envelope.revision,
      processedThrough,
      stateJson,
    });
    if (reconciled.status !== 'reconciled') {
      refusal = {side: 'client', sequence, reason: `reconcile:${reconciled.status}`};
      through = sequence;
      break;
    }
    if (o.prediction.read().correction?.changed) corrections++;
    through = sequence;
  }
  const a = client.read(),
    b = host.read();
  const comparison = a.lastTick < 0 ? null : compareDigests(a, b);
  // 'agree' only when every driven command matched and none was refused; a divergence before a refusal is reported.
  const status =
    comparison?.status === 'diverged' ? 'diverged' : !refusal && comparison?.status === 'equal' ? 'agree' : 'refused';
  return Object.freeze({
    status,
    through,
    refusal: refusal && Object.freeze(refusal),
    comparison,
    corrections,
    client: a,
    host: b,
  });
}
