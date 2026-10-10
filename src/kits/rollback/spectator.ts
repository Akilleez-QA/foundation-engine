/**
 * Optional read-only spectator of a rollback session: it runs only frames whose every input is confirmed, so it
 * never predicts, saves snapshots or rolls back. It consumes exchange messages (`toSpectator`) or direct inputs,
 * keeps a bounded buffer, catches up by a configured number of frames per call, and checks its confirmed checksums
 * against the peers' reports.
 */
import {captureRollbackLimits, rollbackChecksum, utf8BytesWithin} from './limits';
import {validate, type RollbackMessage} from './exchange';
import type {
  RollbackChecksum,
  RollbackDesync,
  RollbackLimits,
  RollbackPorts,
  RollbackRefusal,
  RollbackStart,
  RollbackStatus,
} from './types';

export interface RollbackSpectatorOptions {
  /** The peers' limits (players, inputDelay, byte caps, checksum cadence and retention are used). */
  readonly limits: RollbackLimits;
  readonly neutralInput: string;
  readonly ports: RollbackPorts;
  /** The session's start frame (its `read().startFrame`; default 0): frames below it plus the delay are neutral. */
  readonly sessionStart?: number;
  /** Join mid-session from a confirmed state (for example a peer's `confirmedState()`), validated by checksum. */
  readonly join?: RollbackStart;
  /** Input frames buffered ahead of the spectator's frame, [1, 3600]; inputs beyond are not acknowledged. */
  readonly maxBufferedFrames: number;
  /** Ready frames above which `advance` runs `catchUpFrames` frames instead of one, [0, 3600]. */
  readonly catchUpThreshold: number;
  /** Frames per `advance` while catching up, [1, 60]. */
  readonly catchUpFrames: number;
  readonly signal?: AbortSignal;
}
export type RollbackSpectatorAdvance =
  | Readonly<{status: 'advanced'; frame: number; frames: number; ready: number; checksums: readonly RollbackChecksum[]}>
  | Readonly<{status: 'waiting'; frame: number; waitingFor: readonly number[]}>
  | Readonly<{status: 'desynced'; desync: RollbackDesync}>
  | RollbackRefusal;
export interface RollbackSpectator {
  /** Apply an exchange message from a peer (its `toSpectator` output). */
  receive(message: RollbackMessage): Readonly<{status: 'applied'; accepted: number}> | RollbackRefusal;
  /** What this spectator holds of each player: send it to a peer as the acknowledgement. */
  ack(): readonly number[];
  advance(): RollbackSpectatorAdvance;
  read(): Readonly<{
    status: RollbackStatus;
    reason: string | null;
    frame: number;
    buffered: number;
    desync: RollbackDesync | null;
    stats: Readonly<{frames: number; checked: number; unchecked: number; full: number}>;
  }>;
  /** The current confirmed state text and its checksum. */
  state(): Readonly<{frame: number; checksum: number; state: string}> | null;
  dispose(): void;
}

const whole = (v: unknown, min: number, max: number): v is number =>
  Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;

export function createRollbackSpectator(options: RollbackSpectatorOptions): RollbackSpectator {
  if (options === null || typeof options !== 'object') throw Error('rollback spectator: invalid options');
  const limits = captureRollbackLimits(options.limits);
  const {neutralInput: neutral, ports, signal} = options;
  const sessionStart = options.sessionStart ?? 0;
  if (
    !whole(sessionStart, 0, 2 ** 31 - 1) ||
    !whole(options.maxBufferedFrames, 1, 3600) ||
    !whole(options.catchUpThreshold, 0, 3600) ||
    !whole(options.catchUpFrames, 1, 60)
  )
    throw Error('rollback spectator: invalid limits');
  if (ports === null || typeof ports !== 'object') throw Error('rollback spectator: invalid configuration');
  const {save, load, step, validateInput} = ports;
  if (
    ![save, load, step].every(fn => typeof fn === 'function') ||
    (validateInput !== undefined && typeof validateInput !== 'function')
  )
    throw Error('rollback spectator: invalid configuration');
  if (typeof neutral !== 'string' || utf8BytesWithin(neutral, limits.maxInputBytes) === Infinity)
    throw Error('rollback spectator: invalid neutral input');
  if (signal !== undefined && (signal === null || typeof signal.addEventListener !== 'function'))
    throw Error('rollback spectator: invalid signal');
  const join = options.join;
  if (join !== undefined) {
    if (join === null || typeof join !== 'object' || !whole(join.frame, sessionStart, 2 ** 31 - 1))
      throw Error('rollback spectator: invalid join');
    if (typeof join.state !== 'string' || utf8BytesWithin(join.state, limits.maxStateBytes) === Infinity)
      throw Error('rollback spectator: invalid join');
    if (join.checksum !== rollbackChecksum(join.state)) throw Error('rollback spectator: join checksum mismatch');
    try {
      load(join.state);
    } catch {
      throw Error('rollback spectator: join state refused by load');
    }
  }

  const players = limits.players,
    neutralBelow = sessionStart + limits.inputDelay,
    buffer = options.maxBufferedFrames;
  let status: RollbackStatus = 'running',
    reason: string | null = null,
    busy = false,
    frame = join ? join.frame : sessionStart,
    desync: RollbackDesync | null = null;
  const floor = Math.max(neutralBelow, frame) - 1;
  // Per-player arrays have length `players`; indices are range-checked players.
  const last = new Array<number>(players).fill(floor);
  const inputs = Array.from({length: players}, () => new Map<number, string>());
  const fixed = new Array<number | undefined>(players).fill(undefined);
  const decided = new Array<{at: number; input: string} | undefined>(players).fill(undefined);
  const rule = new Array<string>(players).fill(neutral);
  const history = new Map<number, number>();
  const pending = new Map<number, {player: number; checksum: number}>();
  const stats = {frames: 0, checked: 0, unchecked: 0, full: 0};

  const refusal = (): RollbackRefusal => Object.freeze({status: status === 'running' ? 'busy' : status, reason});
  const fail = (why: string): RollbackRefusal => {
    if (status === 'running') {
      status = 'failed';
      reason = why;
      for (const m of inputs) m.clear();
      pending.clear();
    }
    return refusal();
  };
  const onAbort = () => dispose();
  function dispose() {
    if (status === 'retired') return;
    status = 'retired';
    reason = 'disposed';
    for (const m of inputs) m.clear();
    history.clear();
    pending.clear();
    signal?.removeEventListener('abort', onAbort);
  }
  if (signal?.aborted) dispose();
  else signal?.addEventListener('abort', onAbort, {once: true});

  const fix = (p: number) => {
    const d = decided[p];
    if (!d || fixed[p] !== undefined || last[p]! < d.at) return;
    fixed[p] = d.at;
    // Peers send the fixed input with the decision; a spectator that joined later could not derive it.
    rule[p] = d.input;
  };
  const inputFor = (p: number, f: number) =>
    f < neutralBelow ? neutral : fixed[p] !== undefined && f > fixed[p]! ? rule[p]! : inputs[p]!.get(f);
  const ready = () => {
    let through = Infinity;
    for (let p = 0; p < players; p++) if (fixed[p] === undefined && last[p]! < through) through = last[p]!;
    return through === Infinity ? buffer : Math.max(0, Math.min(buffer, through - frame + 1));
  };
  const compare = (f: number, player: number, remote: number): RollbackDesync | null => {
    const mine = history.get(f);
    if (mine === undefined || mine === remote) return null;
    desync = Object.freeze({frame: f, player, local: mine, remote});
    status = 'desynced';
    reason = 'checksum-mismatch';
    return desync;
  };

  const spectator: RollbackSpectator = {
    receive(message) {
      if (status !== 'running' || busy) return refusal();
      if (validate(message, players, 4096)) return fail('message-invalid');
      busy = true;
      try {
        for (const d of message.departures) {
          if (d.decided === null) continue;
          // A decision below the neutral frames, or without the fixed input, cannot come from a valid peer.
          if (d.decided < neutralBelow - 1 || typeof d.input !== 'string') return fail('remote-departure');
          const known = decided[d.player];
          if (known && known.at !== d.decided) return fail('departure-conflict');
          decided[d.player] = {at: d.decided, input: d.input};
          fix(d.player);
        }
        let accepted = 0;
        for (const e of message.inputs) {
          const p = e.player;
          if (e.frame <= last[p]!) {
            const stored = inputs[p]!.get(e.frame);
            if (stored !== undefined && stored !== e.input) return fail('remote-conflict');
            continue;
          }
          if (e.frame !== last[p]! + 1 || (decided[p] && e.frame > decided[p]!.at)) continue;
          if (e.frame > frame + buffer) {
            stats.full++;
            continue;
          }
          if (utf8BytesWithin(e.input, limits.maxInputBytes) === Infinity) return fail('remote-input-invalid');
          let ok: unknown = true;
          try {
            ok = validateInput ? validateInput(e.input) : true;
          } catch {
            return fail('validate-failed');
          }
          if (ok !== true) return fail('remote-input-invalid');
          inputs[p]!.set(e.frame, e.input);
          last[p] = e.frame;
          accepted++;
          fix(p);
        }
        for (const c of message.checksums) {
          if (c.frame % limits.checksumInterval !== 0 || c.frame < frame - limits.maxChecksumHistory * 4) continue;
          if (history.has(c.frame)) {
            stats.checked++;
            if (compare(c.frame, message.from, c.checksum)) return refusal();
          } else if (c.frame >= frame && !pending.has(c.frame)) {
            if (pending.size >= limits.maxPendingChecksums) stats.unchecked++;
            else pending.set(c.frame, {player: message.from, checksum: c.checksum});
          }
        }
        return Object.freeze({status: 'applied' as const, accepted});
      } finally {
        busy = false;
      }
    },

    ack() {
      return Object.freeze([...last]);
    },

    advance() {
      if (status !== 'running' || busy) return refusal();
      const available = ready();
      if (available === 0) {
        const waitingFor: number[] = [];
        for (let p = 0; p < players; p++) if (fixed[p] === undefined && last[p]! < frame) waitingFor.push(p);
        return Object.freeze({status: 'waiting' as const, frame, waitingFor: Object.freeze(waitingFor)});
      }
      const count = available > options.catchUpThreshold ? Math.min(available, options.catchUpFrames) : 1;
      busy = true;
      try {
        const out: RollbackChecksum[] = [];
        for (let i = 0; i < count; i++) {
          const f = frame;
          if (f % limits.checksumInterval === 0) {
            let text: unknown;
            try {
              text = save();
            } catch {
              return fail('save-failed');
            }
            if (typeof text !== 'string' || utf8BytesWithin(text, limits.maxStateBytes) === Infinity)
              return fail('state-bytes');
            const checksum = rollbackChecksum(text);
            history.set(f, checksum);
            if (history.size > limits.maxChecksumHistory) history.delete(history.keys().next().value!);
            out.push(Object.freeze({frame: f, checksum}));
            const held = pending.get(f);
            if (held) {
              pending.delete(f);
              stats.checked++;
              const found = compare(f, held.player, held.checksum);
              if (found) return Object.freeze({status: 'desynced' as const, desync: found});
            }
          }
          for (const key of pending.keys()) if (key < f) pending.delete(key);
          const row = Array.from({length: players}, (_, p) => inputFor(p, f)!);
          try {
            step(Object.freeze(row), f);
          } catch {
            return fail('step-failed');
          }
          if (status !== 'running') return refusal();
          for (let p = 0; p < players; p++) if (f !== fixed[p]) inputs[p]!.delete(f);
          frame++;
          stats.frames++;
        }
        return Object.freeze({
          status: 'advanced' as const,
          frame,
          frames: count,
          ready: available - count,
          checksums: Object.freeze(out),
        });
      } finally {
        busy = false;
      }
    },

    read() {
      return Object.freeze({
        status,
        reason,
        frame,
        buffered: ready(),
        desync,
        stats: Object.freeze({...stats}),
      });
    },

    state() {
      if (status !== 'running' && status !== 'desynced') return null;
      let text: unknown;
      try {
        text = save();
      } catch {
        return null;
      }
      if (typeof text !== 'string') return null;
      return Object.freeze({frame, checksum: rollbackChecksum(text), state: text});
    },

    dispose,
  };
  return Object.freeze(spectator);
}
