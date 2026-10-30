/**
 * kits/turns/log.ts: a deterministic, bounded command log with undo, redo, preview and replay.
 *
 * The creator supplies the rules (state/command validators and a pure reducer). This owner admits
 * commands, keeps the accepted sequence, and derives every state by replaying that sequence from a
 * captured initial state with a per-position seeded random stream. No timers, storage, DOM or frame work.
 */
import type {DocumentValue} from '../authoring/document';
import {captureJson, captureJsonLimits, type JsonLimits} from '../network/captured-json';
import {createRng, hashSeed, type Rng} from '../../core/rng';
import {hashText} from '../replay/hash';

/** Pure creator reducer outcome. A rejection leaves the log unchanged and records nothing. */
export type TurnReduction<S extends DocumentValue> =
  {readonly accept: true; readonly state: S} | {readonly accept: false; readonly reason: string};

/** Creator-owned rules. `id` names the rules and their version; snapshots of other rules are refused. */
export interface TurnRules<S extends DocumentValue, C extends DocumentValue> {
  readonly id: string;
  /** Must return literal `true` to accept. */
  validateState(value: DocumentValue): value is S;
  /** Must return literal `true` to accept. */
  validateCommand(value: DocumentValue): value is C;
  /**
   * Pure and synchronous. `random` is seeded from the log seed and the command's absolute position,
   * so preview, submit, redo, undo-replay and restore draw exactly the same numbers.
   */
  reduce(context: {readonly state: S; readonly command: C; readonly random: Rng}): TurnReduction<S>;
}

export interface TurnLogLimits {
  /** Retained commands (undo + redo). Also bounds the reducer calls of one undo, replay or restore. */
  readonly maxCommands: number;
  readonly state: JsonLimits;
  readonly command: JsonLimits;
}

/** Plain JSON for a save section. `checksum` is the replay kit's 64-bit `hashText` over seed, base, cursor, initial and head states and every retained command: a drift detector, not a security hash. */
export interface TurnLogSnapshot {
  readonly format: 'turns/1';
  readonly rules: string;
  readonly seed: number;
  readonly base: number;
  readonly initial: DocumentValue;
  readonly commands: readonly DocumentValue[];
  readonly cursor: number;
  readonly checksum: string;
}

export interface TurnLogView<S extends DocumentValue> {
  readonly rules: string;
  /** Owner-local revision: changes on every submit, undo, redo and checkpoint. Echo it in the next call. */
  readonly revision: number;
  /** Absolute number of applied commands since genesis, including checkpointed ones. */
  readonly position: number;
  readonly cursor: number;
  readonly length: number;
  readonly state: S;
  readonly stateJson: string;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

type Blocked = {readonly status: 'stale' | 'busy' | 'retired'};
export type TurnSubmitResult<S extends DocumentValue> =
  | {readonly status: 'applied'; readonly view: TurnLogView<S>}
  | {readonly status: 'rejected'; readonly reason: string}
  | {readonly status: 'invalid'; readonly reason: string}
  | {readonly status: 'full'}
  | Blocked;
export type TurnPreviewResult<S extends DocumentValue> =
  /** `full`: the log is at capacity, so submit would return `full` until `checkpoint` (or undo) frees room. */
  | {readonly status: 'accepted'; readonly state: S; readonly stateJson: string; readonly full: boolean}
  | {readonly status: 'rejected'; readonly reason: string}
  | {readonly status: 'invalid'; readonly reason: string}
  | {readonly status: 'busy' | 'retired'};
export type TurnMoveResult<S extends DocumentValue> =
  | {readonly status: 'applied'; readonly view: TurnLogView<S>}
  | {readonly status: 'empty'}
  | {readonly status: 'diverged'; readonly reason: string}
  | Blocked;

export interface TurnLog<S extends DocumentValue, C extends DocumentValue> {
  read(): TurnLogView<S>;
  /** Run the reducer against the current state without changing anything (deterministic intent preview). */
  preview(command: C): TurnPreviewResult<S>;
  submit(expectedRevision: number, command: C): TurnSubmitResult<S>;
  undo(expectedRevision: number): TurnMoveResult<S>;
  redo(expectedRevision: number): TurnMoveResult<S>;
  /** State after the first `cursor` retained commands, for replay viewers. Changes nothing. */
  replay(
    cursor: number,
  ):
    | {readonly status: 'replayed'; readonly state: S; readonly stateJson: string}
    | {readonly status: 'out-of-range' | 'busy' | 'retired'}
    | {readonly status: 'diverged'; readonly reason: string};
  /** Fold the applied prefix into the initial state; drops undo and redo history. Recovery for `full`. */
  checkpoint(expectedRevision: number): TurnMoveResult<S>;
  snapshot(): TurnLogSnapshot;
  commands(): readonly C[];
  dispose(): void;
}

export interface TurnLogOptions<S extends DocumentValue, C extends DocumentValue> {
  readonly rules: TurnRules<S, C>;
  readonly limits: TurnLogLimits;
  /** Unsigned 32-bit integer or a string name (hashed). Choose it at the start of a run, e.g. from `?seed=`. */
  readonly seed: number | string;
  readonly initial: S;
}

const MAX_REASON = 256;
type Captured = {readonly value: DocumentValue; readonly json: string};

function validId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 256;
}
function checkLimits(limits: TurnLogLimits) {
  if (!limits || !Number.isSafeInteger(limits.maxCommands) || limits.maxCommands <= 0)
    throw Error('turns: invalid maxCommands');
  return Object.freeze({
    maxCommands: limits.maxCommands,
    state: captureJsonLimits(limits.state),
    command: captureJsonLimits(limits.command),
  });
}
function capture(value: unknown, limits: JsonLimits): Captured | string {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return 'not JSON';
  }
  if (typeof json !== 'string') return 'not JSON';
  try {
    const c = captureJson(json, limits);
    return {value: c.value, json: c.json};
  } catch (e) {
    return e instanceof Error ? e.message : 'not JSON';
  }
}
function reasonOf(v: unknown): string {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, MAX_REASON) : 'rejected';
}
/** Seed for the command at absolute `position`. Same function on every path. */
function streamFor(seed: number, position: number): Rng {
  return createRng(hashSeed(JSON.stringify([seed, position])));
}

export function createTurnLog<S extends DocumentValue, C extends DocumentValue>(
  options: TurnLogOptions<S, C>,
): TurnLog<S, C> {
  const opened = openTurnLog(options, FRESH);
  if (opened.status !== 'restored') throw Error(`turns: ${opened.reason}`);
  return opened.log;
}

/**
 * Restore from a saved snapshot by replaying it. Returns a reason instead of throwing for stored data,
 * so the caller can keep (quarantine) the value and start a new run explicitly.
 */
export function restoreTurnLog<S extends DocumentValue, C extends DocumentValue>(
  options: Omit<TurnLogOptions<S, C>, 'seed' | 'initial'>,
  snapshot: unknown,
):
  | {readonly status: 'restored'; readonly log: TurnLog<S, C>}
  | {readonly status: 'invalid' | 'foreign' | 'diverged'; readonly reason: string} {
  return openTurnLog(options, snapshot);
}

const FRESH = Symbol('turns-fresh');

function openTurnLog<S extends DocumentValue, C extends DocumentValue>(
  options: Omit<TurnLogOptions<S, C>, 'seed' | 'initial'> & Partial<Pick<TurnLogOptions<S, C>, 'seed' | 'initial'>>,
  snapshot: unknown,
):
  | {readonly status: 'restored'; readonly log: TurnLog<S, C>}
  | {readonly status: 'invalid' | 'foreign' | 'diverged'; readonly reason: string} {
  const rules = options.rules;
  if (
    !rules ||
    !validId(rules.id) ||
    typeof rules.reduce !== 'function' ||
    typeof rules.validateState !== 'function' ||
    typeof rules.validateCommand !== 'function'
  )
    throw Error('turns: invalid rules');
  const limits = checkLimits(options.limits);
  const {validateState, validateCommand, reduce} = rules,
    rulesId = rules.id;

  let seed: number,
    base: number,
    initial: Captured,
    commands: Captured[] = [],
    cursor: number,
    expectChecksum: string | null = null;
  if (snapshot === FRESH) {
    const s = options.seed;
    if (
      typeof s === 'string'
        ? s.length === 0 || s.length > 256
        : !(Number.isSafeInteger(s) && (s as number) >= 0 && (s as number) <= 0xffffffff)
    )
      throw Error('turns: invalid seed');
    seed = typeof s === 'string' ? hashSeed(s) : (s as number);
    base = 0;
    cursor = 0;
    const c = capture(options.initial, limits.state);
    if (typeof c === 'string') throw Error(`turns: initial state ${c}`);
    if (validateState(c.value) !== true) throw Error('turns: initial state rejected by rules');
    initial = c;
  } else {
    const snap = snapshot as Partial<TurnLogSnapshot> | null;
    if (!snap || typeof snap !== 'object' || snap.format !== 'turns/1')
      return {status: 'invalid', reason: 'unknown snapshot format'};
    if (snap.rules !== rulesId) return {status: 'foreign', reason: 'snapshot belongs to other rules'};
    if (
      !Number.isSafeInteger(snap.seed) ||
      snap.seed! < 0 ||
      snap.seed! > 0xffffffff ||
      !Number.isSafeInteger(snap.base) ||
      snap.base! < 0 ||
      !Array.isArray(snap.commands) ||
      snap.commands.length > limits.maxCommands ||
      !Number.isSafeInteger(snap.cursor) ||
      snap.cursor! < 0 ||
      snap.cursor! > snap.commands.length ||
      typeof snap.checksum !== 'string' ||
      !/^[0-9a-f]{16}$/.test(snap.checksum) ||
      snap.base! > Number.MAX_SAFE_INTEGER - snap.commands.length
    )
      return {status: 'invalid', reason: 'malformed snapshot'};
    seed = snap.seed!;
    base = snap.base!;
    cursor = snap.cursor!;
    expectChecksum = snap.checksum!;
    // Stored data is untrusted: creator validator exceptions become `invalid`, never a throw.
    const accepts = (check: (v: DocumentValue) => boolean, v: DocumentValue) => {
      try {
        return check(v) === true;
      } catch {
        return false;
      }
    };
    const c = capture(snap.initial, limits.state);
    if (typeof c === 'string' || !accepts(validateState, c.value))
      return {status: 'invalid', reason: 'initial state rejected'};
    initial = c;
    for (const raw of snap.commands) {
      const cc = capture(raw, limits.command);
      if (typeof cc === 'string' || !accepts(validateCommand, cc.value))
        return {status: 'invalid', reason: 'command rejected'};
      commands.push(cc);
    }
  }

  let busy = false,
    retired = false,
    revision = 0;
  let head: Captured;
  /** Covers the replayed head and every retained entry (including redo), base and seed. */
  const checksumOf = () =>
    hashText(JSON.stringify([seed, base, cursor, initial.json, head.json, commands.map(c => c.json)]));

  /** Apply one captured command at absolute position. Returns the captured next state or a reason. */
  const step = (
    state: Captured,
    command: Captured,
    position: number,
  ): Captured | {reason: string; rejected: boolean} => {
    const out = reduce({state: state.value as S, command: command.value as C, random: streamFor(seed, position)});
    if (!out || typeof out !== 'object') return {reason: 'reducer returned no outcome', rejected: false};
    if (out.accept !== true)
      return {reason: reasonOf((out as {reason?: unknown}).reason), rejected: out.accept === false};
    const next = capture(out.state, limits.state);
    if (typeof next === 'string') return {reason: `reducer state ${next}`, rejected: false};
    if (validateState(next.value) !== true) return {reason: 'reducer state rejected by rules', rejected: false};
    return next;
  };
  const replayTo = (k: number): Captured | {reason: string} => {
    let state = initial;
    for (let i = 0; i < k; i++) {
      const next = step(state, commands[i]!, base + i); // callers pass k <= commands.length (cursor or a checked k)
      if ('reason' in next) return {reason: `command ${base + i}: ${next.reason}`};
      state = next;
    }
    return state;
  };

  if (snapshot === FRESH) head = initial;
  else {
    // Restore replays creator code over stored commands: a throw there is reported as divergence.
    let restored: Captured | {reason: string};
    try {
      restored = replayTo(cursor);
    } catch (e) {
      return {status: 'diverged', reason: `replay threw: ${reasonOf(e instanceof Error ? e.message : String(e))}`};
    }
    if ('reason' in restored) return {status: 'diverged', reason: restored.reason};
    head = restored;
    if (checksumOf() !== expectChecksum)
      return {status: 'diverged', reason: 'replayed log differs from the saved checksum'};
  }

  const view = (): TurnLogView<S> =>
    Object.freeze({
      rules: rulesId,
      revision,
      position: base + cursor,
      cursor,
      length: commands.length,
      state: head.value as S,
      stateJson: head.json,
      canUndo: cursor > 0,
      canRedo: cursor < commands.length,
    });
  const guard = (mutation: boolean, expected?: unknown): Blocked | null => {
    if (retired) return {status: 'retired'};
    if (busy) return {status: 'busy'};
    // Every mutation must echo an exact revision; a missing or malformed one is stale, never a bypass.
    if (mutation && (!Number.isSafeInteger(expected) || expected !== revision)) return {status: 'stale'};
    return null;
  };
  /** Run creator code under the busy guard; disposal during the callback prevents publication. */
  const guarded = <T>(fn: () => T): T | {status: 'retired'} => {
    busy = true;
    try {
      const r = fn();
      return retired ? {status: 'retired'} : r;
    } finally {
      busy = false;
    }
  };
  const bump = () => {
    if (revision === Number.MAX_SAFE_INTEGER) throw Error('turns: revision exhausted');
    revision++;
  };
  const admit = (command: C): Captured | string => {
    const c = capture(command, limits.command);
    if (typeof c === 'string') return c;
    return validateCommand(c.value) === true ? c : 'command rejected by rules';
  };

  const log: TurnLog<S, C> = {
    read: view,
    preview(command) {
      const blocked = guard(false);
      if (blocked) return blocked as {status: 'busy' | 'retired'};
      return guarded((): TurnPreviewResult<S> => {
        const c = admit(command);
        if (typeof c === 'string') return {status: 'invalid', reason: c};
        const next = step(head, c, base + cursor);
        if ('reason' in next)
          return next.rejected ? {status: 'rejected', reason: next.reason} : {status: 'invalid', reason: next.reason};
        return {
          status: 'accepted',
          state: next.value as S,
          stateJson: next.json,
          full: cursor >= limits.maxCommands || base + cursor >= Number.MAX_SAFE_INTEGER,
        };
      });
    },
    submit(expectedRevision, command) {
      const blocked = guard(true, expectedRevision);
      if (blocked) return blocked;
      // Submitting discards redo entries, so capacity counts only the kept prefix.
      if (cursor >= limits.maxCommands) return {status: 'full'};
      if (base + cursor >= Number.MAX_SAFE_INTEGER) return {status: 'full'};
      return guarded((): TurnSubmitResult<S> => {
        const c = admit(command);
        if (typeof c === 'string') return {status: 'invalid', reason: c};
        const next = step(head, c, base + cursor);
        if ('reason' in next)
          return next.rejected ? {status: 'rejected', reason: next.reason} : {status: 'invalid', reason: next.reason};
        if (retired) return {status: 'retired'};
        bump();
        commands = commands.slice(0, cursor);
        commands.push(c);
        cursor++;
        head = next;
        return {status: 'applied', view: view()};
      });
    },
    undo(expectedRevision) {
      const blocked = guard(true, expectedRevision);
      if (blocked) return blocked;
      if (cursor === 0) return {status: 'empty'};
      return guarded((): TurnMoveResult<S> => {
        const prev = replayTo(cursor - 1);
        if ('reason' in prev) return {status: 'diverged', reason: prev.reason};
        if (retired) return {status: 'retired'};
        bump();
        cursor--;
        head = prev;
        return {status: 'applied', view: view()};
      });
    },
    redo(expectedRevision) {
      const blocked = guard(true, expectedRevision);
      if (blocked) return blocked;
      if (cursor >= commands.length) return {status: 'empty'};
      return guarded((): TurnMoveResult<S> => {
        const next = step(head, commands[cursor]!, base + cursor); // cursor < commands.length (checked above)
        if ('reason' in next) return {status: 'diverged', reason: next.reason};
        if (retired) return {status: 'retired'};
        bump();
        cursor++;
        head = next;
        return {status: 'applied', view: view()};
      });
    },
    replay(k) {
      const blocked = guard(false);
      if (blocked) return blocked as {status: 'busy' | 'retired'};
      if (!Number.isSafeInteger(k) || k < 0 || k > commands.length) return {status: 'out-of-range'};
      return guarded(() => {
        const s = replayTo(k);
        if ('reason' in s) return {status: 'diverged' as const, reason: s.reason};
        return {status: 'replayed' as const, state: s.value as S, stateJson: s.json};
      });
    },
    checkpoint(expectedRevision) {
      const blocked = guard(true, expectedRevision);
      if (blocked) return blocked;
      bump();
      base += cursor;
      initial = head;
      commands = [];
      cursor = 0;
      return {status: 'applied', view: view()};
    },
    snapshot: () =>
      structuredClone({
        format: 'turns/1' as const,
        rules: rulesId,
        seed,
        base,
        initial: initial.value,
        commands: commands.map(c => c.value),
        cursor,
        checksum: checksumOf(),
      }),
    commands: () => Object.freeze(commands.map(c => c.value as C)),
    dispose() {
      retired = true;
    },
  };
  return {status: 'restored', log: Object.freeze(log)};
}
