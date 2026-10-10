/**
 * Awareness: per-agent memory of targets built from stimuli, with alert levels, decay, last-known positions and a flat
 * fact view for a blackboard (for example a behaviour tree runtime's `set`). Bounded, deterministic, saveable.
 */
import {fail, finite, frozenVec, vec, type Vec3} from './senses';

export type AlertLevel = 'unaware' | 'suspicious' | 'alerted';
export type StimulusKind = 'sight' | 'sound' | 'report';
export interface Stimulus {
  readonly target: string;
  readonly kind: StimulusKind;
  /** Strength in [0, 1] (from `sightStrength`, `hearingStrength`, or a squad report's confidence). */
  readonly strength: number;
  /** Where the target was perceived (the sound's origin for hearing). */
  readonly position: Vec3;
}
export interface AwarenessOptions {
  /** Awareness gained per second of full-strength sight, (0, 100]. Default 2. */
  readonly sightRate?: number;
  /** Awareness gained at once per full-strength sound, (0, 1]. Default 0.4. */
  readonly soundImpulse?: number;
  /** Awareness gained at once per full-confidence squad report, (0, 1]. Default 0.5. */
  readonly reportImpulse?: number;
  /** Awareness lost per second without stimulus, [0, 100]. Default 0.1. */
  readonly decay?: number;
  /** [enter, leave] thresholds; leave < enter gives hysteresis. Defaults [0.3, 0.15] and [0.8, 0.5]. */
  readonly suspicious?: readonly [number, number];
  readonly alerted?: readonly [number, number];
  /** Seconds after the last stimulus before an unaware target is forgotten, (0, 1e6]. Default 30. */
  readonly forgetAfter?: number;
  /** Targets remembered at once, [1, 256]. Default 32. */
  readonly maxTargets?: number;
}
export interface TargetMemory {
  readonly target: string;
  readonly awareness: number;
  readonly level: AlertLevel;
  readonly lastKnown: Vec3;
  /** Time of the last stimulus of any kind, and of the last sight. */
  readonly lastStimulus: number;
  readonly lastSeen: number | null;
  /** True when sight reported this target in the latest update. */
  readonly visible: boolean;
}
export type AwarenessFacts = Readonly<Record<string, string | number | boolean | null>>;

const RANK: Record<AlertLevel, number> = {unaware: 0, suspicious: 1, alerted: 2};
const pair = (v: unknown, dflt: readonly [number, number], what: string): [number, number] => {
  if (v === undefined) return [dflt[0], dflt[1]];
  if (!Array.isArray(v) || v.length !== 2) fail(`${what} is [enter, leave]`);
  const a: unknown = v[0],
    b: unknown = v[1];
  if (!finite(a) || !finite(b) || a <= 0 || a > 1 || b < 0 || b > a) fail(`${what} must satisfy 0 ≤ leave ≤ enter ≤ 1`);
  return [a, b];
};
const bounded = (v: unknown, dflt: number, lo: number, hi: number, what: string, open = true): number => {
  const x = v ?? dflt;
  if (!finite(x) || (open ? x <= lo : x < lo) || x > hi)
    fail(`${what} must be within ${open ? '(' : '['}${lo}, ${hi}]`);
  return x;
};

export function createAwareness(options: AwarenessOptions = {}) {
  const sightRate = bounded(options.sightRate, 2, 0, 100, 'sightRate'),
    soundImpulse = bounded(options.soundImpulse, 0.4, 0, 1, 'soundImpulse'),
    reportImpulse = bounded(options.reportImpulse, 0.5, 0, 1, 'reportImpulse'),
    decay = bounded(options.decay, 0.1, 0, 100, 'decay', false),
    forgetAfter = bounded(options.forgetAfter, 30, 0, 1e6, 'forgetAfter'),
    maxTargets = bounded(options.maxTargets, 32, 0, 256, 'maxTargets');
  if (!Number.isSafeInteger(maxTargets)) fail('maxTargets must be an integer');
  const suspicious = pair(options.suspicious, [0.3, 0.15], 'suspicious'),
    alerted = pair(options.alerted, [0.8, 0.5], 'alerted');
  if (alerted[0] < suspicious[0] || alerted[1] < suspicious[1]) fail('alerted thresholds must not be below suspicious');
  interface Entry {
    awareness: number;
    level: AlertLevel;
    lastKnown: Vec3;
    lastStimulus: number;
    lastSeen: number | null;
    visible: boolean;
  }
  const targets = new Map<string, Entry>();
  let clock: number | null = null,
    dropped = 0;
  const levelFor = (e: Entry): AlertLevel => {
    const a = e.awareness;
    if (e.level === 'alerted') return a < alerted[1] ? (a < suspicious[1] ? 'unaware' : 'suspicious') : 'alerted';
    if (a >= alerted[0]) return 'alerted';
    if (e.level === 'suspicious') return a < suspicious[1] ? 'unaware' : 'suspicious';
    return a >= suspicious[0] ? 'suspicious' : 'unaware';
  };
  const view = (id: string, e: Entry): TargetMemory =>
    Object.freeze({
      target: id,
      awareness: e.awareness,
      level: e.level,
      lastKnown: frozenVec(e.lastKnown),
      lastStimulus: e.lastStimulus,
      lastSeen: e.lastSeen,
      visible: e.visible,
    });
  const ordered = () =>
    [...targets].sort((a, b) => b[1].awareness - a[1].awareness || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const api = {
    /**
     * Advance to `now` (seconds, nondecreasing) with this update's stimuli (at most 256). Targets without sight this
     * update lose `decay × elapsed`; sight adds `sightRate × strength × elapsed`; sounds and reports add an impulse.
     * Returns the number of stimuli dropped because memory was full of more-aware targets.
     */
    update(now: number, stimuli: readonly Stimulus[] = []): number {
      if (!finite(now) || now < 0) fail('now must be a nonnegative finite time');
      if (clock !== null && now < clock) fail('time must not go backwards');
      if (!Array.isArray(stimuli) || stimuli.length > 256) fail('at most 256 stimuli per update');
      const elapsed = clock === null ? 0 : now - clock;
      clock = now;
      const copies: Stimulus[] = [];
      for (let i = 0; i < stimuli.length; i++) {
        const s = stimuli[i];
        if (!s || typeof s !== 'object') fail('a stimulus must be an object');
        const target: unknown = s.target,
          kind: unknown = s.kind,
          strength: unknown = s.strength;
        if (typeof target !== 'string' || !target || target.length > 256) fail('stimulus target must be a name');
        if (kind !== 'sight' && kind !== 'sound' && kind !== 'report') fail('stimulus kind is sight, sound or report');
        if (!finite(strength) || strength < 0 || strength > 1) fail('stimulus strength must be within [0, 1]');
        copies.push({target, kind, strength, position: vec(s.position, 'stimulus position')});
      }
      const seen = new Set<string>();
      for (const s of copies) if (s.kind === 'sight' && s.strength > 0) seen.add(s.target);
      for (const [id, e] of targets) {
        e.visible = false;
        if (!seen.has(id)) e.awareness = Math.max(0, e.awareness - decay * elapsed);
      }
      let lost = 0;
      for (const s of copies) {
        if (s.strength <= 0) continue;
        let e = targets.get(s.target);
        if (!e) {
          if (targets.size >= maxTargets) {
            // Replace the least aware target only if this stimulus would make the newcomer more aware.
            const gain =
              s.kind === 'sight'
                ? sightRate * s.strength * elapsed
                : (s.kind === 'sound' ? soundImpulse : reportImpulse) * s.strength;
            const weakest = ordered().at(-1)!;
            if (gain <= weakest[1].awareness) {
              lost++;
              continue;
            }
            targets.delete(weakest[0]);
          }
          e = {
            awareness: 0,
            level: 'unaware',
            lastKnown: s.position,
            lastStimulus: now,
            lastSeen: null,
            visible: false,
          };
          targets.set(s.target, e);
        }
        const gain =
          s.kind === 'sight'
            ? sightRate * s.strength * elapsed
            : (s.kind === 'sound' ? soundImpulse : reportImpulse) * s.strength;
        e.awareness = Math.min(1, e.awareness + gain);
        e.lastKnown = s.position;
        e.lastStimulus = now;
        if (s.kind === 'sight') {
          e.visible = true;
          e.lastSeen = now;
        }
      }
      for (const [id, e] of targets) {
        e.level = levelFor(e);
        if (e.level === 'unaware' && e.awareness === 0 && now - e.lastStimulus >= forgetAfter) targets.delete(id);
      }
      dropped += lost;
      return lost;
    },
    /** The memory of one target, or null. */
    recall(target: string): TargetMemory | null {
      const e = targets.get(target);
      return e ? view(target, e) : null;
    },
    /** All remembered targets, most aware first (ties by id). */
    targets(): readonly TargetMemory[] {
      return Object.freeze(ordered().map(([id, e]) => view(id, e)));
    },
    /** The highest level over all targets. */
    get alert(): AlertLevel {
      let best: AlertLevel = 'unaware';
      for (const e of targets.values()) if (RANK[e.level] > RANK[best]) best = e.level;
      return best;
    },
    /** The most aware target, or null. */
    get focus(): TargetMemory | null {
      const top = ordered()[0];
      return top ? view(top[0], top[1]) : null;
    },
    get dropped(): number {
      return dropped;
    },
    /**
     * Flat scalar facts for a blackboard: alert, focus target, its awareness, visibility, last-known x/y/z and seconds
     * since last seen (null if never). Keys are `<prefix>.<name>`.
     */
    facts(prefix = 'perception'): AwarenessFacts {
      if (typeof prefix !== 'string' || !prefix || prefix.length > 64) fail('prefix must be 1-64 characters');
      const f = ordered()[0];
      const now = clock ?? 0;
      return Object.freeze({
        [`${prefix}.alert`]: api.alert,
        [`${prefix}.target`]: f ? f[0] : null,
        [`${prefix}.awareness`]: f ? f[1].awareness : 0,
        [`${prefix}.visible`]: f ? f[1].visible : false,
        [`${prefix}.x`]: f ? f[1].lastKnown[0] : null,
        [`${prefix}.y`]: f ? f[1].lastKnown[1] : null,
        [`${prefix}.z`]: f ? f[1].lastKnown[2] : null,
        [`${prefix}.seenAgo`]: f && f[1].lastSeen !== null ? now - f[1].lastSeen : null,
      });
    },
    /** Write `facts(prefix)` into any blackboard-like sink with `set(key, value)`. */
    write(sink: {set(key: string, value: string | number | boolean | null): unknown}, prefix = 'perception'): void {
      for (const [k, v] of Object.entries(api.facts(prefix))) sink.set(k, v);
    },
    /** Forget everything (for example on respawn). */
    clear(): void {
      targets.clear();
    },
  };
  return api;
}
export type Awareness = ReturnType<typeof createAwareness>;
