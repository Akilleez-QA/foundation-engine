import { captureJson, captureJsonLimits } from './captured-json';
import type { Prediction, PredictionBaseline, PredictionInput, PredictionOptions, PredictionRefusal, PredictionSnapshot } from './prediction-types';
export type { Prediction, PredictionBaseline, PredictionInput, PredictionLimits, PredictionOptions, PredictionSnapshot, PredictionValue } from './prediction-types';

const counter = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const empty: readonly PredictionInput[] = Object.freeze([]);

/** Optional finite data projection. Owns no transport, scheduler, accepted game state or side effects. */
export function createPrediction(options: PredictionOptions): Prediction {
  const { epoch, validateState, validateInput, reduce } = options;
  if (!identity(epoch) || [validateState, validateInput, reduce].some(fn => typeof fn !== 'function'))
    throw Error('prediction: invalid configuration');
  const supplied = options.limits;
  const limits = Object.freeze({ state: captureJsonLimits(supplied.state), input: captureJsonLimits(supplied.input),
    maxPending: supplied.maxPending, maxPendingBytes: supplied.maxPendingBytes, maxReplaySteps: supplied.maxReplaySteps });
  if (![limits.maxPending, limits.maxPendingBytes, limits.maxReplaySteps].every(n => Number.isSafeInteger(n) && n > 0))
    throw Error('prediction: invalid limits');
  const initial = options.baseline;
  const revision = initial.revision, processedThrough = initial.processedThrough, stateJson = initial.stateJson;
  if (!counter(revision) || !counter(processedThrough)) throw Error('prediction: invalid baseline');
  let confirmed: PredictionSnapshot['confirmed'] = Object.freeze({ revision, processedThrough,
    state: captureJson(stateJson, limits.state, validateState) });
  let predicted: PredictionSnapshot['predicted'] = confirmed.state;
  let pending = empty, pendingBytes = 0, issuedThrough = processedThrough;
  let status: PredictionSnapshot['status'] = 'ready', reason: string | null = null;
  let correction: PredictionSnapshot['correction'] = null, busy = false;

  const refusal = (): PredictionRefusal => Object.freeze({ status: status === 'retired' ? 'retired' : 'unavailable' });
  function invalidate(why = 'invalidated') {
    if (status !== 'ready') return;
    status = 'unavailable'; reason = identity(why) ? why : 'invalidated';
    pending = empty; pendingBytes = 0; predicted = null; correction = null;
  }
  function fail(why: string): PredictionRefusal { invalidate(why); return refusal(); }
  // Wrap validators so callback-triggered retirement cannot invoke another creator callback.
  const checkState = (value: Parameters<typeof validateState>[0]) => status === 'ready' && validateState(value) === true;
  const checkInput = (value: Parameters<typeof validateInput>[0]) => status === 'ready' && validateInput(value) === true;
  return Object.freeze({
    push(inputJson: string) {
      if (status !== 'ready') return refusal();
      if (busy) return Object.freeze({ status: 'busy' as const });
      busy = true;
      try {
        if (issuedThrough === Number.MAX_SAFE_INTEGER) return fail('sequence-exhausted');
        if (pending.length >= limits.maxPending) return fail('pending-count');
        const captured = captureJson(inputJson, limits.input, checkInput);
        if (status !== 'ready') return refusal();
        if (captured.bytes > limits.maxPendingBytes - pendingBytes) return fail('pending-bytes');
        const output = reduce(predicted!.value, captured.value);
        if (status !== 'ready') return refusal();
        const next = captureJson(output, limits.state, checkState);
        if (status !== 'ready') return refusal();
        const input = Object.freeze({ ...captured, sequence: issuedThrough + 1 });
        pending = Object.freeze([...pending, input]); pendingBytes += input.bytes;
        issuedThrough = input.sequence; predicted = next; correction = null;
        return Object.freeze({ status: 'predicted' as const, input });
      } catch { return fail('input-or-reducer-failed'); }
      finally { busy = false; }
    },
    reconcile(baseline: PredictionBaseline) {
      if (status !== 'ready') return refusal();
      if (busy) return Object.freeze({ status: 'busy' as const });
      busy = true;
      try {
        // Capture supplied scalars once before invoking any creator validator/reducer.
        const incomingEpoch = baseline.epoch, nextRevision = baseline.revision;
        const through = baseline.processedThrough, json = baseline.stateJson;
        if (status !== 'ready') return refusal();
        if (!identity(incomingEpoch) || !counter(nextRevision) || !counter(through)) return fail('invalid-baseline');
        if (incomingEpoch !== epoch) return Object.freeze({ status: 'foreign' as const });
        if (nextRevision < confirmed!.revision) return Object.freeze({ status: 'obsolete' as const });
        if (through < confirmed!.processedThrough || through > issuedThrough) return fail('invalid-prefix');
        const suffix = pending.filter(input => input.sequence > through);
        if (nextRevision > confirmed!.revision && suffix.length > limits.maxReplaySteps) return fail('replay-limit');
        const state = captureJson(json, limits.state, checkState);
        if (status !== 'ready') return refusal();
        if (nextRevision === confirmed!.revision) {
          if (through !== confirmed!.processedThrough || state.json !== confirmed!.state.json) return fail('baseline-conflict');
          return Object.freeze({ status: 'duplicate' as const });
        }
        let next = state, bytes = 0;
        for (const input of suffix) {
          const output = reduce(next.value, input.value);
          if (status !== 'ready') return refusal();
          next = captureJson(output, limits.state, checkState);
          if (status !== 'ready') return refusal();
          bytes += input.bytes;
        }
        correction = Object.freeze({ changed: next.json !== predicted!.json, replayed: suffix.length });
        confirmed = Object.freeze({ revision: nextRevision, processedThrough: through, state });
        predicted = next; pending = Object.freeze(suffix); pendingBytes = bytes;
        return Object.freeze({ status: 'reconciled' as const });
      } catch { return fail('baseline-or-reducer-failed'); }
      finally { busy = false; }
    },
    read() { return Object.freeze({ status, epoch, confirmed, predicted, pending, pendingBytes, issuedThrough, correction, reason }); },
    invalidate,
    dispose() {
      status = 'retired'; reason = 'disposed'; confirmed = null; predicted = null;
      pending = empty; pendingBytes = 0; correction = null; issuedThrough = 0;
    },
  });
}
