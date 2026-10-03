import { captureRollbackLimits, rollbackChecksum, utf8BytesWithin } from './limits';
import type {
  RollbackAdvanceResult, RollbackChecksum, RollbackChecksumResult, RollbackConfirmedState, RollbackDesync,
  RollbackLocalResult, RollbackOptions, RollbackRefusal, RollbackRemoteResult, RollbackSession, RollbackSnapshot,
  RollbackStatus,
} from './types';

const NO_CHECKSUMS: readonly RollbackChecksum[] = Object.freeze([]);
const frameNumber = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const uint32 = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffffffff;

/**
 * Optional speculative-execution session for a deterministic fixed-step simulation shared by 2-8 peers.
 * Owns per-frame input history, state snapshots, rollback/resimulation and confirmed-state checksums.
 * Owns no transport, clock, timer, ECS world or game rules: the host calls it from its fixed lane and moves the
 * returned facts over its own reliable, ordered transport.
 */
export function createRollbackSession(options: RollbackOptions): RollbackSession {
  if (options === null || typeof options !== 'object') throw Error('rollback: invalid configuration');
  const limits = captureRollbackLimits(options.limits);
  const local = options.local, neutral = options.neutralInput, ports = options.ports, signal = options.signal;
  if (!Number.isSafeInteger(local) || local < 0 || local >= limits.players) throw Error('rollback: invalid local player');
  if (ports === null || typeof ports !== 'object') throw Error('rollback: invalid configuration');
  const { save, load, step, validateInput } = ports;
  if (![save, load, step].every(fn => typeof fn === 'function') || (validateInput !== undefined && typeof validateInput !== 'function'))
    throw Error('rollback: invalid configuration');
  if (typeof neutral !== 'string' || utf8BytesWithin(neutral, limits.maxInputBytes) === Infinity)
    throw Error('rollback: invalid neutral input');
  if (validateInput && validateInput(neutral) !== true) throw Error('rollback: invalid neutral input');
  if (signal !== undefined && (signal === null || typeof signal.addEventListener !== 'function')) throw Error('rollback: invalid signal');

  const P = limits.maxPredictionFrames, D = limits.inputDelay, players = limits.players;
  /** Highest remote input frame a peer with identical limits can legitimately have sent ahead of our frame. */
  const maxLead = P + 2 * D + 2;
  const config = `rollback-v1:${JSON.stringify(limits)}:${rollbackChecksum(neutral)}`;

  let status: RollbackStatus = 'running', reason: string | null = null, busy = false;
  let current = 0, rollbackFrom: number | null = null, recordedThrough = -1;
  let desync: RollbackDesync | null = null;
  let confirmed: { frame: number; state: string; checksum?: number } | null = null;
  // Per-player arrays have length `players`; every index into them is `local`, a range-checked remote player or p < players.
  const lastConfirmed = new Array<number>(players).fill(D - 1);
  const lastInput = new Array<string>(players).fill(neutral);
  const inputs = Array.from({ length: players }, () => new Map<number, string>());
  const used = new Map<number, readonly string[]>();
  const snapshots = new Map<number, string>();
  const history = new Map<number, number>();
  const pending = new Map<string, { player: number; frame: number; checksum: number }>();
  const stats = { advanced: 0, stalls: 0, rollbacks: 0, resimulated: 0, maxRollback: 0, steps: 0, saves: 0, loads: 0 };

  const clear = () => {
    for (const map of inputs) map.clear();
    used.clear(); snapshots.clear(); history.clear(); pending.clear(); rollbackFrom = null;
  };
  const refusal = (): RollbackRefusal => Object.freeze({ status: status === 'running' ? 'busy' : status, reason });
  const fail = (why: string): RollbackRefusal => {
    if (status === 'running') { status = 'failed'; reason = why; clear(); }
    return refusal();
  };
  const onAbort = () => dispose();
  function dispose() {
    if (status === 'retired') return;
    status = 'retired'; reason = 'disposed'; clear(); confirmed = null;
    signal?.removeEventListener('abort', onAbort);
  }
  if (signal?.aborted) dispose(); else signal?.addEventListener('abort', onAbort, { once: true });

  /** Exact input admission; `undefined` means rejected. A validator that retires the session is reported as such. */
  const admit = (input: unknown): string | undefined => {
    if (typeof input !== 'string' || utf8BytesWithin(input, limits.maxInputBytes) === Infinity) return undefined;
    if (validateInput && validateInput(input) !== true) return undefined;
    return input;
  };
  const inputFor = (player: number, frame: number): string => {
    if (frame < D) return neutral;
    if (frame <= lastConfirmed[player]!) return inputs[player]!.get(frame)!;
    return lastInput[player]!;
  };
  const gather = (frame: number) => {
    const out = new Array<string>(players);
    let predicted = false;
    for (let p = 0; p < players; p++) { out[p] = inputFor(p, frame); if (frame > lastConfirmed[p]!) predicted = true; }
    return { inputs: Object.freeze(out), predicted };
  };
  const confirmedFrame = () => {
    let min = Infinity;
    for (let p = 0; p < players; p++) if (lastConfirmed[p]! < min) min = lastConfirmed[p]!;
    return min;
  };
  const saveState = (): string | RollbackRefusal => {
    let text: unknown;
    try { text = save(); } catch { return fail('save-failed'); }
    stats.saves++;
    if (status !== 'running') return refusal();
    if (typeof text !== 'string' || utf8BytesWithin(text, limits.maxStateBytes) === Infinity) return fail('state-bytes');
    return text;
  };
  const runStep = (frameInputs: readonly string[], frame: number): RollbackRefusal | null => {
    try { step(frameInputs, frame); } catch { return fail('step-failed'); }
    stats.steps++;
    return status === 'running' ? null : refusal();
  };
  const markDesync = (found: RollbackDesync) => {
    desync = Object.freeze(found); status = 'desynced'; reason = 'checksum-mismatch'; clear();
  };
  /** Record confirmed checksums for frames whose snapshot is final; resolve held remote reports. */
  const record = (): { checksums: readonly RollbackChecksum[] } | Readonly<{ status: 'desynced'; desync: RollbackDesync; checksums: readonly RollbackChecksum[] }> => {
    const upTo = Math.min(confirmedFrame() + 1, current);
    let out: RollbackChecksum[] | null = null;
    while (recordedThrough < upTo && snapshots.has(recordedThrough + 1)) {
      const frame = ++recordedThrough, state = snapshots.get(frame)!;
      confirmed = { frame, state };
      if (frame % limits.checksumInterval !== 0) continue;
      const checksum = rollbackChecksum(state);
      confirmed.checksum = checksum;
      history.set(frame, checksum);
      if (history.size > limits.maxChecksumHistory) history.delete(history.keys().next().value!);
      (out ??= []).push(Object.freeze({ frame, checksum }));
      for (let p = 0; p < players; p++) {
        const held = pending.get(`${p}:${frame}`);
        if (!held) continue;
        pending.delete(`${p}:${frame}`);
        if (held.checksum === checksum) continue;
        markDesync({ frame, player: p, local: checksum, remote: held.checksum });
        return Object.freeze({ status: 'desynced' as const, desync: desync!, checksums: Object.freeze(out!) });
      }
    }
    return { checksums: out ? Object.freeze(out) : NO_CHECKSUMS };
  };
  const prune = () => {
    const floor = current - P - 1;
    for (const map of [used, snapshots, ...inputs]) for (const frame of map.keys()) if (frame < floor) map.delete(frame);
  };

  const session: RollbackSession = {
    local(input: string): RollbackLocalResult {
      if (status !== 'running' || busy) return refusal();
      const frame = lastConfirmed[local]! + 1;
      if (frame > current + D) return Object.freeze({ status: 'full' as const, frame });
      busy = true;
      try {
        let admitted: string | undefined;
        try { admitted = admit(input); } catch { return fail('validate-failed'); }
        if (status !== 'running') return refusal();
        if (admitted === undefined) return Object.freeze({ status: 'invalid' as const, frame });
        inputs[local]!.set(frame, admitted); lastConfirmed[local] = frame; lastInput[local] = admitted;
        return Object.freeze({ status: 'queued' as const, frame, input: admitted });
      } finally { busy = false; }
    },

    remote(player: number, frame: number, input: string): RollbackRemoteResult {
      if (status !== 'running' || busy) return refusal();
      if (!Number.isSafeInteger(player) || player < 0 || player >= players || player === local) return fail('remote-player');
      if (!frameNumber(frame) || frame < D) return fail('remote-frame');
      if (frame <= lastConfirmed[player]!) {
        const stored = inputs[player]!.get(frame);
        // Pruned history cannot be re-verified; an equal resend is idempotent, a different one is a protocol fault.
        if (stored === undefined || stored === input) return Object.freeze({ status: 'duplicate' as const, rollbackFrom: null });
        return fail('remote-conflict');
      }
      if (frame !== lastConfirmed[player]! + 1) return fail('remote-gap');
      if (frame > current + maxLead) return fail('remote-lead');
      busy = true;
      try {
        let admitted: string | undefined;
        try { admitted = admit(input); } catch { return fail('validate-failed'); }
        if (status !== 'running') return refusal();
        if (admitted === undefined) return fail('remote-input-invalid');
        inputs[player]!.set(frame, admitted); lastConfirmed[player] = frame; lastInput[player] = admitted;
        let from: number | null = null;
        if (frame < current && used.get(frame)?.[player] !== admitted) {
          from = frame;
          rollbackFrom = rollbackFrom === null ? frame : Math.min(rollbackFrom, frame);
        }
        return Object.freeze({ status: 'accepted' as const, rollbackFrom: from });
      } finally { busy = false; }
    },

    remoteChecksum(player: number, frame: number, checksum: number): RollbackChecksumResult {
      if (status !== 'running' || busy) return refusal();
      if (!Number.isSafeInteger(player) || player < 0 || player >= players || player === local) return fail('remote-player');
      if (!frameNumber(frame) || !uint32(checksum)) return fail('remote-checksum');
      if (frame % limits.checksumInterval !== 0) return Object.freeze({ status: 'inconclusive' as const });
      if (frame <= recordedThrough) {
        const mine = history.get(frame);
        if (mine === undefined) return Object.freeze({ status: 'inconclusive' as const });
        if (mine === checksum) return Object.freeze({ status: 'match' as const });
        markDesync({ frame, player, local: mine, remote: checksum });
        return Object.freeze({ status: 'desynced' as const, desync: desync! });
      }
      const key = `${player}:${frame}`, held = pending.get(key);
      if (held) return held.checksum === checksum ? Object.freeze({ status: 'pending' as const }) : fail('checksum-conflict');
      if (pending.size >= limits.maxPendingChecksums) return fail('checksum-overflow');
      pending.set(key, { player, frame, checksum });
      return Object.freeze({ status: 'pending' as const });
    },

    advance(): RollbackAdvanceResult {
      if (status !== 'running' || busy) return refusal();
      busy = true;
      try {
        let resimulated = 0;
        if (rollbackFrom !== null && rollbackFrom < current) {
          const from = rollbackFrom, base = snapshots.get(from);
          if (base === undefined) return fail('rollback-window');
          try { load(base); } catch { return fail('load-failed'); }
          stats.loads++;
          if (status !== 'running') return refusal();
          for (let frame = from; frame < current; frame++) {
            if (frame > from) {
              const text = saveState();
              if (typeof text !== 'string') return text;
              snapshots.set(frame, text);
            }
            const next = gather(frame);
            used.set(frame, next.inputs);
            const stopped = runStep(next.inputs, frame);
            if (stopped) return stopped;
            resimulated++;
          }
          stats.rollbacks++; stats.resimulated += resimulated;
          if (resimulated > stats.maxRollback) stats.maxRollback = resimulated;
        }
        rollbackFrom = null;
        const frame = current;
        if (lastConfirmed[local]! < current) {
          const recorded = record();
          if ('status' in recorded) return recorded;
          return Object.freeze({ status: 'needs-local-input' as const, frame, resimulated, checksums: recorded.checksums });
        }
        if (current - (confirmedFrame() + 1) >= P) {
          stats.stalls++;
          const recorded = record();
          if ('status' in recorded) return recorded;
          const waitingFor: number[] = [];
          for (let p = 0; p < players; p++) if (lastConfirmed[p]! + 1 + P <= current) waitingFor.push(p);
          return Object.freeze({ status: 'stalled' as const, frame, resimulated, waitingFor: Object.freeze(waitingFor), checksums: recorded.checksums });
        }
        const text = saveState();
        if (typeof text !== 'string') return text;
        snapshots.set(current, text);
        const recorded = record();
        if ('status' in recorded) return recorded;
        const next = gather(current);
        used.set(current, next.inputs);
        const stopped = runStep(next.inputs, current);
        if (stopped) return stopped;
        current++; stats.advanced++;
        prune();
        return Object.freeze({ status: 'advanced' as const, frame, resimulated, predicted: next.predicted, checksums: recorded.checksums });
      } finally { busy = false; }
    },

    read(): RollbackSnapshot {
      const confirmedAt = confirmedFrame();
      return Object.freeze({
        status, reason, config, local, frame: current, confirmedFrame: confirmedAt,
        confirmedInputs: Object.freeze([...lastConfirmed]),
        predictedFrames: Math.max(0, current - (confirmedAt + 1)),
        frameAdvantage: Object.freeze(lastConfirmed.map((through, p) => p === local ? 0 : current - (through - D))),
        desync, stats: Object.freeze({ ...stats }),
      });
    },

    confirmedState(): RollbackConfirmedState | null {
      if (!confirmed) return null;
      confirmed.checksum ??= rollbackChecksum(confirmed.state);
      return Object.freeze({ frame: confirmed.frame, checksum: confirmed.checksum, state: confirmed.state });
    },

    dispose,
  };
  return Object.freeze(session);
}
