import {rollbackChecksum, utf8BytesWithin} from './limits';
import type {RollbackRefusal, RollbackStatus, SyncTest, SyncTestOptions, SyncTestResult} from './types';

const inRange = (value: unknown, min: number, max: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;

/**
 * Optional local determinism check for the ports a rollback session would use, with no peer and no transport.
 * After every live step it saves the live result, then loads the state from `checkDistance` frames ago,
 * resimulates with the recorded inputs and compares each resimulated state's checksum with the LIVE checksum of the
 * same frame (as GGPO's sync test does). A mismatch names the first frame whose saved state differs: hidden state
 * outside `save`, an incomplete `load`, a wall-clock or unseeded random read, a one-shot value read outside the
 * inputs, a value the codec does not round-trip (for example -0 through JSON) that later changes the result, or a
 * state change made outside `step`. A pass covers only the frames and inputs exercised.
 */
export function createRollbackSyncTest(options: SyncTestOptions): SyncTest {
  if (options === null || typeof options !== 'object') throw Error('rollback sync test: invalid configuration');
  const {checkDistance: distance, maxStateBytes, maxInputBytes, players, ports, signal} = options;
  if (
    !inRange(distance, 1, 60) ||
    !inRange(maxStateBytes, 1, 16 * 1024 * 1024) ||
    !inRange(maxInputBytes, 1, 4096) ||
    !inRange(players, 1, 8)
  )
    throw Error('rollback sync test: invalid limits');
  if (ports === null || typeof ports !== 'object') throw Error('rollback sync test: invalid configuration');
  const {save, load, step} = ports;
  if (![save, load, step].every(fn => typeof fn === 'function'))
    throw Error('rollback sync test: invalid configuration');
  if (signal !== undefined && (signal === null || typeof signal.addEventListener !== 'function'))
    throw Error('rollback sync test: invalid signal');

  let status: RollbackStatus = 'running',
    reason: string | null = null,
    busy = false,
    frame = 0;
  let desync: Readonly<{frame: number; expected: number; actual: number}> | null = null;
  const snapshots = new Map<number, string>(),
    checksums = new Map<number, number>(),
    inputs = new Map<number, readonly string[]>();
  const clear = () => {
    snapshots.clear();
    checksums.clear();
    inputs.clear();
  };
  const refusal = (): RollbackRefusal => Object.freeze({status: status === 'running' ? 'busy' : status, reason});
  const fail = (why: string): RollbackRefusal => {
    if (status === 'running') {
      status = 'failed';
      reason = why;
      clear();
    }
    return refusal();
  };
  const onAbort = () => dispose();
  function dispose() {
    if (status === 'retired') return;
    status = 'retired';
    reason = 'disposed';
    clear();
    signal?.removeEventListener('abort', onAbort);
  }
  if (signal?.aborted) dispose();
  else signal?.addEventListener('abort', onAbort, {once: true});

  /** Save and compare with the first checksum recorded for `at`; returns a result to stop with, or null. */
  const check = (at: number): SyncTestResult | null => {
    let text: unknown;
    try {
      text = save();
    } catch {
      return fail('save-failed');
    }
    if (status !== 'running') return refusal();
    if (typeof text !== 'string' || utf8BytesWithin(text, maxStateBytes) === Infinity) return fail('state-bytes');
    const actual = rollbackChecksum(text),
      expected = checksums.get(at);
    if (expected === undefined) {
      checksums.set(at, actual);
      snapshots.set(at, text);
      return null;
    }
    if (expected === actual) return null;
    desync = Object.freeze({frame: at, expected, actual});
    status = 'desynced';
    reason = 'checksum-mismatch';
    clear();
    return Object.freeze({status: 'desynced' as const, frame: at, expected, actual});
  };
  const run = (frameInputs: readonly string[], at: number): SyncTestResult | null => {
    try {
      step(frameInputs, at);
    } catch {
      return fail('step-failed');
    }
    return status === 'running' ? null : refusal();
  };

  return Object.freeze({
    advance(supplied: readonly string[]): SyncTestResult {
      if (status !== 'running' || busy) return refusal();
      if (!Array.isArray(supplied) || supplied.length !== players) return Object.freeze({status: 'invalid' as const});
      const captured: string[] = [];
      for (let i = 0; i < players; i++) {
        const input: unknown = supplied[i];
        if (typeof input !== 'string' || utf8BytesWithin(input, maxInputBytes) === Infinity)
          return Object.freeze({status: 'invalid' as const});
        captured.push(input);
      }
      const frameInputs = Object.freeze(captured);
      busy = true;
      try {
        const at = frame;
        const first = check(at) ?? run(frameInputs, at);
        if (first) return first;
        inputs.set(at, frameInputs);
        frame++;
        // Record (or compare) the LIVE result first, so every resimulation below is checked against it.
        const live = check(frame);
        if (live) return live;
        const from = Math.max(0, frame - distance);
        try {
          load(snapshots.get(from)!);
        } catch {
          return fail('load-failed');
        }
        if (status !== 'running') return refusal();
        let resimulated = 0;
        for (let f = from; f < frame; f++) {
          const stopped = (f > from ? check(f) : null) ?? run(inputs.get(f)!, f);
          if (stopped) return stopped;
          resimulated++;
        }
        const end = check(frame);
        if (end) return end;
        const floor = frame - distance;
        for (const map of [snapshots, checksums, inputs])
          for (const key of map.keys()) if (key < floor) map.delete(key);
        return Object.freeze({status: 'checked' as const, frame: at, resimulated});
      } finally {
        busy = false;
      }
    },
    read() {
      return Object.freeze({status, reason, frame, desync});
    },
    dispose,
  });
}
