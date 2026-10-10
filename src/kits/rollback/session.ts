import {captureRollbackLimits, rollbackChecksum, utf8BytesWithin} from './limits';
import {captureExtensions, chunkEvidence} from './extensions';
import type {
  RollbackDelayChange,
  RollbackDelayResult,
  RollbackDeparture,
  RollbackDepartureResult,
  RollbackEvidence,
  RollbackHistoryResult,
  RollbackWireInput,
  RollbackAdvanceResult,
  RollbackChecksum,
  RollbackChecksumResult,
  RollbackConfirmedState,
  RollbackDesync,
  RollbackLocalResult,
  RollbackOptions,
  RollbackRefusal,
  RollbackRemoteResult,
  RollbackSession,
  RollbackSnapshot,
  RollbackStatus,
} from './types';

const NO_CHECKSUMS: readonly RollbackChecksum[] = Object.freeze([]);
const frameNumber = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const uint32 = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffffffff;

/**
 * Optional speculative-execution session for a deterministic fixed-step simulation shared by 2-8 peers.
 * Owns per-frame input history, state snapshots, rollback/resimulation and confirmed-state checksums.
 * Owns no transport, clock, timer, ECS world or game rules: the host calls it from its fixed lane and moves the
 * returned facts over its own reliable, ordered transport.
 */
export function createRollbackSession(options: RollbackOptions): RollbackSession {
  if (options === null || typeof options !== 'object') throw Error('rollback: invalid configuration');
  const limits = captureRollbackLimits(options.limits);
  const local = options.local,
    neutral = options.neutralInput,
    ports = options.ports,
    signal = options.signal;
  if (!Number.isSafeInteger(local) || local < 0 || local >= limits.players)
    throw Error('rollback: invalid local player');
  if (ports === null || typeof ports !== 'object') throw Error('rollback: invalid configuration');
  const {save, load, step, validateInput} = ports;
  if (
    ![save, load, step].every(fn => typeof fn === 'function') ||
    (validateInput !== undefined && typeof validateInput !== 'function')
  )
    throw Error('rollback: invalid configuration');
  if (typeof neutral !== 'string' || utf8BytesWithin(neutral, limits.maxInputBytes) === Infinity)
    throw Error('rollback: invalid neutral input');
  if (validateInput && validateInput(neutral) !== true) throw Error('rollback: invalid neutral input');
  if (signal !== undefined && (signal === null || typeof signal.addEventListener !== 'function'))
    throw Error('rollback: invalid signal');
  const ext = captureExtensions(options, limits);

  const P = limits.maxPredictionFrames,
    D = limits.inputDelay,
    players = limits.players,
    S = ext.start?.frame ?? 0,
    /** Frames below this use the neutral input for every player. */
    neutralBelow = S + D,
    maxDelay = ext.delay?.maxDelay ?? D,
    retain = Math.max(P + 1, ext.retainInputFrames);
  /** Highest remote input frame a peer with identical limits can legitimately have sent ahead of our frame. */
  const maxLead = P + 2 * maxDelay + 2;
  const config = `rollback-v1:${JSON.stringify(limits)}:${rollbackChecksum(neutral)}${ext.configSuffix}`;
  if (ext.start) {
    try {
      load(ext.start.state);
    } catch {
      throw Error('rollback: start state refused by load');
    }
  }

  let status: RollbackStatus = 'running',
    reason: string | null = null,
    busy = false;
  let current = S,
    rollbackFrom: number | null = null,
    recordedThrough = S - 1;
  let desync: RollbackDesync | null = null;
  let confirmed: {frame: number; state: string; checksum?: number} | null = ext.start
    ? {frame: S, state: ext.start.state, checksum: ext.start.checksum}
    : null;
  // Per-player arrays have length `players`; every index into them is `local`, a range-checked remote player or p < players.
  const lastConfirmed = new Array<number>(players).fill(neutralBelow - 1);
  const lastInput = new Array<string>(players).fill(neutral);
  const inputs = Array.from({length: players}, () => new Map<number, string>());
  const used = new Map<number, readonly string[]>();
  const snapshots = new Map<number, string>();
  const history = new Map<number, number>();
  const pending = new Map<string, {player: number; frame: number; checksum: number}>();
  const stats = {advanced: 0, stalls: 0, rollbacks: 0, resimulated: 0, maxRollback: 0, steps: 0, saves: 0, loads: 0};
  /** Agreed delay changes, ordered by `from`; attached to the authority's input frames in `attached`. */
  const changes: RollbackDelayChange[] = [];
  const attached = new Map<number, RollbackDelayChange>();
  let proposal: number | null = null,
    /** The delay before the oldest retained change (changes that every retained frame has passed are folded in). */
    baseDelay = D,
    /** Effective frame of the newest decision (never pruned: spacing checks must agree on every peer). */
    lastFrom = -Infinity;
  /** Departure agreement per player; `fixed[p]` is the agreed last frame once final, and `rule[p]` its later input. */
  interface Leaving {
    reports: Map<number, number>;
    decided: number | null;
    final: boolean;
  }
  const leaving = new Map<number, Leaving>();
  const fixed = new Array<number | undefined>(players).fill(undefined);
  const rule = new Array<string>(players).fill(neutral);
  /** Retained state text of recent checksum frames, for desync evidence. */
  const evidenceStates = new Map<number, {state: string; checksum: number}>();

  const clear = () => {
    for (const map of inputs) map.clear();
    attached.clear();
    used.clear();
    snapshots.clear();
    history.clear();
    pending.clear();
    rollbackFrom = null;
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
    confirmed = null;
    evidenceStates.clear();
    signal?.removeEventListener('abort', onAbort);
  }
  if (signal?.aborted) dispose();
  else signal?.addEventListener('abort', onAbort, {once: true});

  /** Exact input admission; `undefined` means rejected. A validator that retires the session is reported as such. */
  const admit = (input: unknown): string | undefined => {
    if (typeof input !== 'string' || utf8BytesWithin(input, limits.maxInputBytes) === Infinity) return undefined;
    if (validateInput && validateInput(input) !== true) return undefined;
    return input;
  };
  const inputFor = (player: number, frame: number): string => {
    if (frame < neutralBelow) return neutral;
    if (frame <= lastConfirmed[player]!) return inputs[player]!.get(frame)!;
    if (fixed[player] !== undefined) return rule[player]!;
    return lastInput[player]!;
  };
  const gather = (frame: number) => {
    const out = new Array<string>(players);
    let predicted = false;
    for (let p = 0; p < players; p++) {
      out[p] = inputFor(p, frame);
      if (frame > lastConfirmed[p]! && fixed[p] === undefined) predicted = true;
    }
    return {inputs: Object.freeze(out), predicted};
  };
  const confirmedFrame = () => {
    let min = Infinity;
    for (let p = 0; p < players; p++) if (fixed[p] === undefined && lastConfirmed[p]! < min) min = lastConfirmed[p]!;
    return min;
  };
  /** The delay that applies to input frame `frame`. */
  const delayAt = (frame: number) => {
    let delay = baseDelay;
    for (const change of changes) if (change.from <= frame) delay = change.delay;
    return delay;
  };
  const lastDelay = () => (changes.length ? changes[changes.length - 1]!.delay : baseDelay);
  /** Admit a delay decision attached to the authority's input `frame`; a string is a protocol-fault reason. */
  const admitChange = (frame: number, change: unknown): RollbackDelayChange | string => {
    const policy = ext.delay;
    if (!policy) return 'remote-delay';
    if (change === null || typeof change !== 'object') return 'remote-delay';
    const {delay, from} = change as RollbackDelayChange;
    if (
      !Number.isSafeInteger(delay) ||
      !Number.isSafeInteger(from) ||
      delay < policy.minDelay ||
      delay > policy.maxDelay ||
      delay === lastDelay() ||
      Math.abs(delay - lastDelay()) > policy.maxStep ||
      from < frame + P + maxDelay + 1 ||
      from < lastFrom + policy.minSpacing
    )
      return 'remote-delay';
    // Every peer learns a decision before its own input frontier reaches `from` (see README); a late one is a fault.
    if (from <= lastConfirmed[local]!) return 'delay-late';
    return Object.freeze({delay, from});
  };
  const saveState = (): string | RollbackRefusal => {
    let text: unknown;
    try {
      text = save();
    } catch {
      return fail('save-failed');
    }
    stats.saves++;
    if (status !== 'running') return refusal();
    if (typeof text !== 'string' || utf8BytesWithin(text, limits.maxStateBytes) === Infinity)
      return fail('state-bytes');
    return text;
  };
  const runStep = (frameInputs: readonly string[], frame: number): RollbackRefusal | null => {
    try {
      step(frameInputs, frame);
    } catch {
      return fail('step-failed');
    }
    stats.steps++;
    return status === 'running' ? null : refusal();
  };
  const markDesync = (found: RollbackDesync) => {
    desync = Object.freeze(found);
    status = 'desynced';
    reason = 'checksum-mismatch';
    clear();
  };
  /** Record confirmed checksums for frames whose snapshot is final; resolve held remote reports. */
  const record = ():
    | {checksums: readonly RollbackChecksum[]}
    | Readonly<{status: 'desynced'; desync: RollbackDesync; checksums: readonly RollbackChecksum[]}> => {
    const upTo = Math.min(confirmedFrame() + 1, current);
    let out: RollbackChecksum[] | null = null;
    while (recordedThrough < upTo && snapshots.has(recordedThrough + 1)) {
      const frame = ++recordedThrough,
        state = snapshots.get(frame)!;
      confirmed = {frame, state};
      if (frame % limits.checksumInterval !== 0) continue;
      const checksum = rollbackChecksum(state);
      confirmed.checksum = checksum;
      history.set(frame, checksum);
      if (history.size > limits.maxChecksumHistory) history.delete(history.keys().next().value!);
      if (ext.evidence) {
        evidenceStates.set(frame, {state, checksum});
        if (evidenceStates.size > ext.evidence.frames) evidenceStates.delete(evidenceStates.keys().next().value!);
      }
      (out ??= []).push(Object.freeze({frame, checksum}));
      for (let p = 0; p < players; p++) {
        const held = pending.get(`${p}:${frame}`);
        if (!held) continue;
        pending.delete(`${p}:${frame}`);
        if (held.checksum === checksum) continue;
        markDesync({frame, player: p, local: checksum, remote: held.checksum});
        return Object.freeze({status: 'desynced' as const, desync: desync!, checksums: Object.freeze(out!)});
      }
    }
    return {checksums: out ? Object.freeze(out) : NO_CHECKSUMS};
  };
  const prune = () => {
    const floor = current - P - 1,
      inputFloor = current - retain;
    for (const map of [used, snapshots]) for (const frame of map.keys()) if (frame < floor) map.delete(frame);
    for (const map of [attached, ...inputs]) for (const frame of map.keys()) if (frame < inputFloor) map.delete(frame);
    // Keep the newest change that has taken effect plus every later one.
    while (changes.length > 0 && changes[0]!.from < inputFloor - maxLead && changes[0]!.from <= lastConfirmed[local]!)
      baseDelay = changes.shift()!.delay;
  };
  const departure = (player: number): RollbackDeparture => {
    const entry = leaving.get(player)!;
    return Object.freeze({
      player,
      reports: Object.freeze([...entry.reports].sort((a, b) => a[0] - b[0]).map(r => Object.freeze(r))),
      decided: entry.decided,
      final: entry.final,
      input: entry.final ? rule[player]! : null,
    });
  };
  /** Start leaving for `player` (own report = what this peer holds); idempotent. */
  const beginLeaving = (player: number): Leaving => {
    let entry = leaving.get(player);
    if (!entry) {
      entry = {reports: new Map([[local, lastConfirmed[player]!]]), decided: null, final: false};
      leaving.set(player, entry);
    }
    return entry;
  };
  /** Decide and finalize departures whose reports and inputs are complete. */
  const settle = () => {
    for (const [player, entry] of leaving) {
      if (entry.final) continue;
      if (entry.decided === null) {
        let complete = true,
          survivors = 0;
        for (let p = 0; p < players; p++) {
          if (leaving.has(p)) continue;
          survivors++;
          if (!entry.reports.has(p)) complete = false;
        }
        // Without a quorum of remaining players this peer may be the isolated side of a partition: wait.
        if (!complete || survivors < ext.departure!.quorum!) continue;
        entry.decided = Math.max(...entry.reports.values());
      }
      if (lastConfirmed[player]! < entry.decided) continue;
      entry.final = true;
      fixed[player] = entry.decided;
      rule[player] = ext.departure!.input === 'repeat' ? lastInput[player]! : neutral;
      for (const [frame, row] of used)
        if (frame > entry.decided && frame < current && row[player] !== rule[player])
          rollbackFrom = rollbackFrom === null ? frame : Math.min(rollbackFrom, frame);
    }
  };
  /** The highest frame of a departing player this peer may still accept. */
  const departureCap = (player: number) => {
    const entry = leaving.get(player);
    return entry ? (entry.decided ?? entry.reports.get(local)!) : Infinity;
  };

  const session: RollbackSession = {
    local(input: string): RollbackLocalResult {
      if (status !== 'running' || busy) return refusal();
      const frame = lastConfirmed[local]! + 1,
        delay = delayAt(frame);
      if (frame > current + delay) return Object.freeze({status: 'full' as const, frame});
      busy = true;
      try {
        let admitted: string | undefined;
        try {
          admitted = admit(input);
        } catch {
          return fail('validate-failed');
        }
        if (status !== 'running') return refusal();
        if (admitted === undefined) return Object.freeze({status: 'invalid' as const, frame});
        // A delay increase taking effect at this frame fills the new gap with this input (held, not an edge).
        const grow = changes.some(c => c.from === frame) ? delay - delayAt(frame - 1) : 0;
        const through = frame + Math.max(0, Math.min(grow, current + delay - frame));
        for (let f = frame; f <= through; f++) inputs[local]!.set(f, admitted);
        lastConfirmed[local] = through;
        lastInput[local] = admitted;
        let change: RollbackDelayChange | undefined;
        if (proposal !== null) {
          change = Object.freeze({
            delay: proposal,
            from: Math.max(through + P + maxDelay + 1, lastFrom + ext.delay!.minSpacing),
          });
          proposal = null;
          changes.push(change);
          lastFrom = change.from;
          attached.set(through, change);
        }
        const out: {status: 'queued'; frame: number; input: string; through?: number; delay?: RollbackDelayChange} = {
          status: 'queued',
          frame,
          input: admitted,
        };
        if (through > frame) out.through = through;
        if (change) out.delay = change;
        return Object.freeze(out);
      } finally {
        busy = false;
      }
    },

    remote(player: number, frame: number, input: string, delay?: RollbackDelayChange): RollbackRemoteResult {
      if (status !== 'running' || busy) return refusal();
      if (!Number.isSafeInteger(player) || player < 0 || player >= players || player === local)
        return fail('remote-player');
      if (!frameNumber(frame) || frame < neutralBelow) return fail('remote-frame');
      if (frame <= lastConfirmed[player]!) {
        const stored = inputs[player]!.get(frame);
        // Pruned history cannot be re-verified; an equal resend is idempotent, a different one is a protocol fault.
        if (stored === undefined || stored === input)
          return Object.freeze({status: 'duplicate' as const, rollbackFrom: null});
        return fail('remote-conflict');
      }
      if (fixed[player] !== undefined || frame > departureCap(player))
        return Object.freeze({status: 'ignored' as const, rollbackFrom: null});
      if (frame !== lastConfirmed[player]! + 1) return fail('remote-gap');
      if (frame > current + maxLead) return fail('remote-lead');
      busy = true;
      try {
        let admitted: string | undefined;
        try {
          admitted = admit(input);
        } catch {
          return fail('validate-failed');
        }
        if (status !== 'running') return refusal();
        if (admitted === undefined) return fail('remote-input-invalid');
        let change: RollbackDelayChange | undefined;
        if (delay !== undefined) {
          if (player !== ext.delay?.authority) return fail('remote-delay');
          const checked = admitChange(frame, delay);
          if (typeof checked === 'string') return fail(checked);
          change = checked;
        }
        inputs[player]!.set(frame, admitted);
        lastConfirmed[player] = frame;
        lastInput[player] = admitted;
        if (change) {
          changes.push(change);
          lastFrom = change.from;
          attached.set(frame, change);
        }
        let from: number | null = null;
        if (frame < current && used.get(frame)?.[player] !== admitted) {
          from = frame;
          rollbackFrom = rollbackFrom === null ? frame : Math.min(rollbackFrom, frame);
        }
        if (leaving.has(player)) settle();
        return Object.freeze({status: 'accepted' as const, rollbackFrom: from});
      } finally {
        busy = false;
      }
    },

    remoteChecksum(player: number, frame: number, checksum: number): RollbackChecksumResult {
      if (status !== 'running' || busy) return refusal();
      if (!Number.isSafeInteger(player) || player < 0 || player >= players || player === local)
        return fail('remote-player');
      if (!frameNumber(frame) || !uint32(checksum)) return fail('remote-checksum');
      if (frame % limits.checksumInterval !== 0 || frame < S) return Object.freeze({status: 'inconclusive' as const});
      if (frame <= recordedThrough) {
        const mine = history.get(frame);
        if (mine === undefined) return Object.freeze({status: 'inconclusive' as const});
        if (mine === checksum) return Object.freeze({status: 'match' as const});
        markDesync({frame, player, local: mine, remote: checksum});
        return Object.freeze({status: 'desynced' as const, desync: desync!});
      }
      const key = `${player}:${frame}`,
        held = pending.get(key);
      if (held)
        return held.checksum === checksum ? Object.freeze({status: 'pending' as const}) : fail('checksum-conflict');
      if (pending.size >= limits.maxPendingChecksums) return fail('checksum-overflow');
      pending.set(key, {player, frame, checksum});
      return Object.freeze({status: 'pending' as const});
    },

    advance(): RollbackAdvanceResult {
      if (status !== 'running' || busy) return refusal();
      busy = true;
      try {
        let resimulated = 0;
        if (rollbackFrom !== null && rollbackFrom < current) {
          const from = rollbackFrom,
            base = snapshots.get(from);
          if (base === undefined) return fail('rollback-window');
          try {
            load(base);
          } catch {
            return fail('load-failed');
          }
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
          stats.rollbacks++;
          stats.resimulated += resimulated;
          if (resimulated > stats.maxRollback) stats.maxRollback = resimulated;
        }
        rollbackFrom = null;
        const frame = current;
        if (lastConfirmed[local]! < current) {
          const recorded = record();
          if ('status' in recorded) return recorded;
          return Object.freeze({
            status: 'needs-local-input' as const,
            frame,
            resimulated,
            checksums: recorded.checksums,
          });
        }
        if (current - (confirmedFrame() + 1) >= P) {
          stats.stalls++;
          const recorded = record();
          if ('status' in recorded) return recorded;
          const waitingFor: number[] = [];
          for (let p = 0; p < players; p++)
            if (fixed[p] === undefined && lastConfirmed[p]! + 1 + P <= current) waitingFor.push(p);
          return Object.freeze({
            status: 'stalled' as const,
            frame,
            resimulated,
            waitingFor: Object.freeze(waitingFor),
            checksums: recorded.checksums,
          });
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
        current++;
        stats.advanced++;
        prune();
        return Object.freeze({
          status: 'advanced' as const,
          frame,
          resimulated,
          predicted: next.predicted,
          checksums: recorded.checksums,
        });
      } finally {
        busy = false;
      }
    },

    read(): RollbackSnapshot {
      const confirmedAt = confirmedFrame();
      return Object.freeze({
        status,
        reason,
        config,
        local,
        frame: current,
        confirmedFrame: confirmedAt,
        confirmedInputs: Object.freeze([...lastConfirmed]),
        predictedFrames: Math.max(0, current - (confirmedAt + 1)),
        frameAdvantage: Object.freeze(
          lastConfirmed.map((through, p) =>
            p === local || fixed[p] !== undefined ? 0 : current - (through - delayAt(through)),
          ),
        ),
        desync,
        stats: Object.freeze({...stats}),
        delay: delayAt(lastConfirmed[local]! + 1),
        delayChanges: Object.freeze([...changes]),
        departures: Object.freeze([...leaving.keys()].sort((a, b) => a - b).map(departure)),
        startFrame: S,
        retainedInputFrames: retain,
        maxLead,
      });
    },

    confirmedState(): RollbackConfirmedState | null {
      if (!confirmed) return null;
      confirmed.checksum ??= rollbackChecksum(confirmed.state);
      return Object.freeze({frame: confirmed.frame, checksum: confirmed.checksum, state: confirmed.state});
    },

    dispose,

    proposeDelay(delay: number): RollbackDelayResult {
      if (status !== 'running' || busy) return refusal();
      const policy = ext.delay;
      const invalid = (why: 'not-authority' | 'disabled' | 'range' | 'step' | 'unchanged' | 'busy-proposal') =>
        Object.freeze({status: 'invalid' as const, reason: why});
      if (!policy) return invalid('disabled');
      if (local !== policy.authority) return invalid('not-authority');
      if (fixed[local] !== undefined) return invalid('not-authority');
      if (!Number.isSafeInteger(delay) || delay < policy.minDelay || delay > policy.maxDelay) return invalid('range');
      if (proposal !== null) return invalid('busy-proposal');
      if (delay === lastDelay()) return invalid('unchanged');
      if (Math.abs(delay - lastDelay()) > policy.maxStep) return invalid('step');
      proposal = delay;
      return Object.freeze({status: 'pending' as const, delay});
    },

    disconnect(player: number): RollbackDepartureResult {
      if (status !== 'running' || busy) return refusal();
      if (!ext.departure) return Object.freeze({status: 'unsupported' as const});
      if (!Number.isSafeInteger(player) || player < 0 || player >= players || player === local)
        return Object.freeze({status: 'ignored' as const});
      const entry = beginLeaving(player);
      settle();
      return Object.freeze({
        status: entry.final ? ('departed' as const) : ('leaving' as const),
        decided: entry.decided,
      });
    },

    remoteDeparture(from, player, reports, decided): RollbackDepartureResult {
      if (status !== 'running' || busy) return refusal();
      if (!ext.departure) return Object.freeze({status: 'unsupported' as const});
      if (!Number.isSafeInteger(from) || from < 0 || from >= players || from === local) return fail('remote-player');
      if (!Number.isSafeInteger(player) || player < 0 || player >= players || player === from)
        return fail('remote-departure');
      if (leaving.has(from)) {
        // A peer this one holds as leaving accuses it in turn. While this peer's own decision on that peer is open
        // (it may be the isolated side), the accusation wins and this peer fails closed; once decided with a quorum,
        // the accuser is out and its messages are ignored.
        if (player === local && leaving.get(from)!.decided === null) return fail('local-departed');
        return Object.freeze({status: 'ignored' as const});
      }
      if (player === local) return fail('local-departed');
      if (!Array.isArray(reports) || reports.length < 1 || reports.length > players) return fail('remote-departure');
      if (decided !== null && (!Number.isSafeInteger(decided) || decided < neutralBelow - 1))
        return fail('remote-departure');
      for (const report of reports as readonly unknown[]) {
        if (!Array.isArray(report) || report.length !== 2) return fail('remote-departure');
        const [reporter, last] = report as unknown[];
        if (
          !Number.isSafeInteger(reporter) ||
          (reporter as number) < 0 ||
          (reporter as number) >= players ||
          reporter === player ||
          !Number.isSafeInteger(last) ||
          (last as number) < neutralBelow - 1 ||
          (last as number) > current + maxLead
        )
          return fail('remote-departure');
      }
      const entry = beginLeaving(player);
      for (const [reporter, last] of reports) {
        const known = entry.reports.get(reporter);
        if (known === undefined) entry.reports.set(reporter, last);
        else if (known !== last) return fail('departure-conflict');
      }
      if (decided !== null) {
        if (entry.decided === null) {
          if (decided < Math.max(...entry.reports.values())) return fail('departure-conflict');
          entry.decided = decided;
        } else if (entry.decided !== decided) return fail('departure-conflict');
      }
      if (entry.decided !== null && entry.decided < Math.max(...entry.reports.values()))
        return fail('departure-conflict');
      settle();
      return Object.freeze({
        status: entry.final ? ('departed' as const) : ('leaving' as const),
        decided: entry.decided,
      });
    },

    history(player: number, from: number, max: number): RollbackHistoryResult {
      if (status !== 'running' || busy) return refusal();
      if (!Number.isSafeInteger(player) || player < 0 || player >= players || !frameNumber(from))
        return Object.freeze({status: 'ok' as const, entries: Object.freeze([])});
      const start = Math.max(from, neutralBelow),
        last = Math.min(lastConfirmed[player]!, start + Math.max(0, Math.min(Math.floor(max), 4096)) - 1);
      if (start <= last && !inputs[player]!.has(start)) {
        let oldest = start;
        while (oldest <= lastConfirmed[player]! && !inputs[player]!.has(oldest)) oldest++;
        return Object.freeze({status: 'pruned' as const, oldest});
      }
      const entries: RollbackWireInput[] = [];
      for (let frame = start; frame <= last; frame++) {
        const input = inputs[player]!.get(frame)!,
          delay = player === ext.delay?.authority ? attached.get(frame) : undefined;
        entries.push(Object.freeze(delay ? {player, frame, input, delay} : {player, frame, input}));
      }
      return Object.freeze({status: 'ok' as const, entries: Object.freeze(entries)});
    },

    recentChecksums(max: number): readonly RollbackChecksum[] {
      const n = Math.max(0, Math.min(Math.floor(max) || 0, history.size));
      if (n === 0) return NO_CHECKSUMS;
      const out = [...history].slice(-n).map(([frame, checksum]) => Object.freeze({frame, checksum}));
      return Object.freeze(out);
    },

    evidence(frame?: number): RollbackEvidence {
      const at = frame ?? desync?.frame ?? -1;
      if (!ext.evidence) return Object.freeze({status: 'unavailable' as const, frame: at, reason: 'disabled' as const});
      const kept = evidenceStates.get(at);
      if (!kept) return Object.freeze({status: 'unavailable' as const, frame: at, reason: 'not-retained' as const});
      return chunkEvidence(ext.evidence, at, kept.checksum, kept.state);
    },
  };
  return Object.freeze(session);
}
