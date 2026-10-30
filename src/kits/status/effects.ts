import {isStatusId, StatusError, statusTable, type StatusDefinition, type StatusRules} from './rules';

/** One active status on one target. Ticks are the owner's clock. */
export interface StatusInstance {
  readonly id: string;
  readonly stacks: number;
  readonly appliedAt: number;
  /** Last application or decay step: decay counts from here. */
  readonly lastChange: number;
  readonly expiresAt: number | null;
  /** Independent policy: one expiry per stack, ascending. Empty otherwise. */
  readonly timers: readonly number[];
  readonly source: string | null;
}
export interface Immunity {
  readonly key: string;
  readonly ids: readonly string[];
  readonly tags: readonly string[];
  /** Tick at which it ends, or null until cleared. */
  readonly until: number | null;
}
/**
 * Events. Loss events carry the stacks lost and the stacks `remaining` (0 when the status ended); a partial loss
 * (some independent timers expired, a decay step, a partial removal) is reported too, so a game can redraw only
 * what changed.
 */
export type StatusEvent = Readonly<
  | {kind: 'applied' | 'stacked'; target: string; id: string; stacks: number; source: string | null}
  | {kind: 'periodic'; target: string; id: string; stacks: number; source: string | null}
  | {
      kind: 'expired' | 'decayed' | 'removed' | 'consumed' | 'replaced';
      target: string;
      id: string;
      stacks: number;
      remaining: number;
    }
  | {kind: 'triggered'; target: string; id: string; trigger: string; stacks: number; source: string | null}
  | {kind: 'transformed'; target: string; id: string; into: string}
  | {kind: 'immunity-dropped'; target: string; id: string}
>;
export type ApplyResult = Readonly<{
  /** applied: accepted (stacks may already be at the cap); immune, blocked and capacity change nothing. */
  outcome: 'applied' | 'immune' | 'blocked' | 'capacity';
  events: readonly StatusEvent[];
}>;
export interface StatusOptions {
  /** Starting tick (default 0). */
  readonly now?: number;
  /** Targets the owner admits (1–65,536, default 1,024). */
  readonly maxTargets?: number;
  /** Active statuses per target (1–256, default 32). */
  readonly maxPerTarget?: number;
  /** Immunities per target (1–256, default 32). */
  readonly maxImmunities?: number;
  /** Largest `advance` in one call (1–3,600 ticks, default 600). */
  readonly maxAdvance?: number;
}
export interface StatusSnapshot {
  readonly version: 1;
  readonly signature: string;
  readonly now: number;
  readonly targets: readonly Readonly<{
    target: string;
    statuses: readonly StatusInstance[];
    immunities: readonly Immunity[];
  }>[];
}

interface Live {
  id: string;
  stacks: number;
  appliedAt: number;
  lastChange: number;
  expiresAt: number | null;
  timers: number[];
  source: string | null;
}
interface Target {
  statuses: Map<string, Live>;
  immunities: Map<string, Immunity>;
}

/** The clock stops here; durations (≤ 2^40) past it remain representable. */
const MAX_NOW = 2 ** 50;
const MAX_TICK_VALUE = MAX_NOW + 2 ** 41;
/** Immunity ids/tags per immunity, both in `setImmunity` and in restore. */
const MAX_IMMUNITY_LIST = 64;
const AFTER = 'after:';
const KEY = /^[A-Za-z0-9_.:-]{1,72}$/;
const isKey = (v: unknown): v is string => typeof v === 'string' && KEY.test(v);
const freezeInstance = (s: Live): StatusInstance => Object.freeze({...s, timers: Object.freeze([...s.timers])});
const cloneTarget = (t: Target): Target => ({
  statuses: new Map([...t.statuses].map(([k, s]) => [k, {...s, timers: [...s.timers]}])),
  immunities: new Map(t.immunities),
});
const loss = (
  kind: 'expired' | 'decayed' | 'removed' | 'consumed' | 'replaced',
  target: string,
  id: string,
  stacks: number,
  remaining: number,
): StatusEvent => Object.freeze({kind, target, id, stacks, remaining});

/**
 * Status effects for many targets on one fixed clock. `apply` works on a copy of the one target and publishes it only
 * when accepted. `advance` mutates in place: with validated rules it cannot fail part-way. Processing order is
 * deterministic: targets and statuses in id order.
 */
export function createStatusEffects(rules: StatusRules, options: StatusOptions = {}) {
  const defs = statusTable(rules);
  const signature = rules.signature;
  if (!options || typeof options !== 'object') throw new StatusError('options must be an object');
  const bound = (v: number | undefined, fallback: number, max: number, what: string) => {
    const value = v ?? fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new StatusError(`${what} must be in 1..${max}`);
    return value;
  };
  const maxTargets = bound(options.maxTargets, 1024, 65536, 'maxTargets');
  const maxPerTarget = bound(options.maxPerTarget, 32, 256, 'maxPerTarget');
  const maxImmunities = bound(options.maxImmunities, 32, 256, 'maxImmunities');
  const maxAdvance = bound(options.maxAdvance, 600, 3600, 'maxAdvance');
  let now = options.now ?? 0;
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_NOW) throw new StatusError('now must be a tick');
  let targets = new Map<string, Target>();
  let order: string[] | null = null; // cached sorted target ids
  const setTarget = (key: string, t: Target) => {
    if (t.statuses.size || t.immunities.size) {
      if (!targets.has(key)) order = null;
      targets.set(key, t);
    } else if (targets.delete(key)) order = null;
  };

  const def = (sid: string): StatusDefinition => {
    const d = typeof sid === 'string' ? defs.get(sid) : undefined;
    if (!d) throw new StatusError(`unknown status ${String(sid)}`);
    return d;
  };
  const targetId = (t: unknown): string => {
    if (!isStatusId(t)) throw new StatusError(`invalid target ${JSON.stringify(t)}`);
    return t;
  };
  const immuneTo = (target: Target | undefined, d: StatusDefinition) => {
    if (!target) return false;
    for (const im of target.immunities.values())
      if (im.ids.includes(d.id) || im.tags.some(tag => d.tags.includes(tag))) return true;
    return false;
  };
  /** Remove a status entirely, granting its after-immunity when it ended on its own. */
  const end = (
    target: Target,
    key: string,
    live: Live,
    kind: 'expired' | 'decayed' | 'removed' | 'consumed' | 'replaced',
    lost: number,
    events: StatusEvent[],
  ) => {
    target.statuses.delete(live.id);
    events.push(loss(kind, key, live.id, lost, 0));
    const after = def(live.id).afterImmunity;
    if (after && kind !== 'removed' && kind !== 'replaced') {
      const ik = AFTER + live.id;
      if (target.immunities.has(ik) || target.immunities.size < maxImmunities)
        target.immunities.set(ik, Object.freeze({key: ik, ids: after.ids, tags: after.tags, until: now + after.ticks}));
      else events.push(Object.freeze({kind: 'immunity-dropped', target: key, id: live.id}));
    }
  };

  // Apply to a working copy. Transform chains are validated acyclic, so depth ≤ the number of definitions.
  const applyTo = (
    target: Target,
    key: string,
    d: StatusDefinition,
    stacks: number,
    source: string | null,
    events: StatusEvent[],
    depth: number,
  ): ApplyResult['outcome'] => {
    if (depth > defs.size) throw new StatusError('transform chain too deep');
    if (immuneTo(target, d)) return 'immune';
    const existing = target.statuses.get(d.id);
    if (!existing) {
      if (d.group !== null) {
        const occupant = [...target.statuses.values()].find(s => def(s.id).group === d.group);
        if (occupant) {
          if (d.groupPolicy === 'block') return 'blocked';
          end(target, key, occupant, 'replaced', occupant.stacks, events);
        }
      }
      if (target.statuses.size >= maxPerTarget) return 'capacity';
      const count = Math.min(stacks, d.maxStacks);
      target.statuses.set(d.id, {
        id: d.id,
        stacks: count,
        appliedAt: now,
        lastChange: now,
        expiresAt: d.duration === null ? null : now + d.duration,
        timers: d.policy === 'independent' ? Array.from({length: count}, () => now + d.duration!) : [],
        source,
      });
      events.push(Object.freeze({kind: 'applied', target: key, id: d.id, stacks: count, source}));
    } else {
      const added = Math.min(stacks, d.maxStacks - existing.stacks);
      existing.stacks += added;
      existing.lastChange = now;
      if (source !== null) existing.source = source;
      if (d.duration !== null) {
        if (d.policy === 'refresh') existing.expiresAt = now + d.duration;
        else if (d.policy === 'extend')
          existing.expiresAt = Math.min(now + d.maxDuration!, (existing.expiresAt ?? now) + d.duration);
        else if (d.policy === 'independent') {
          // At the cap, each surplus application refreshes one oldest timer.
          const refresh = Math.min(stacks - added, existing.timers.length);
          existing.timers.splice(0, refresh);
          for (let i = 0; i < added + refresh; i++) existing.timers.push(now + d.duration);
          existing.timers.sort((a, b) => a - b);
          existing.expiresAt = existing.timers[existing.timers.length - 1]!;
        }
      }
      events.push(
        Object.freeze({kind: 'stacked', target: key, id: d.id, stacks: existing.stacks, source: existing.source}),
      );
    }
    const live = target.statuses.get(d.id)!;
    const t = d.threshold;
    if (t && live.stacks >= t.stacks) {
      // Try the whole threshold on a copy: if the transform would be refused (immunity, including one granted by
      // the consumed status itself, an exclusive group or capacity), nothing fires and the stacks stay capped.
      const trial = cloneTarget(target);
      const trialEvents: StatusEvent[] = [];
      const trialLive = trial.statuses.get(d.id)!;
      if (t.trigger !== null)
        trialEvents.push(
          Object.freeze({
            kind: 'triggered',
            target: key,
            id: d.id,
            trigger: t.trigger,
            stacks: trialLive.stacks,
            source: trialLive.source,
          }),
        );
      if (t.consume) end(trial, key, trialLive, 'consumed', trialLive.stacks, trialEvents);
      if (t.become !== null) {
        trialEvents.push(Object.freeze({kind: 'transformed', target: key, id: d.id, into: t.become}));
        const outcome = applyTo(trial, key, def(t.become), t.becomeStacks, source, trialEvents, depth + 1);
        if (outcome !== 'applied') return 'applied';
      }
      target.statuses = trial.statuses;
      target.immunities = trial.immunities;
      events.push(...trialEvents);
    }
    return 'applied';
  };

  const read = (t: unknown) => targets.get(targetId(t));
  const optionRecord = <T extends object>(o: T | undefined, what: string): Partial<T> => {
    if (o === undefined) return {};
    if (!o || typeof o !== 'object') throw new StatusError(`${what} must be an object`);
    return o;
  };

  const tick = (events: StatusEvent[]) => {
    now++;
    order ??= [...targets.keys()].sort();
    for (const key of order) {
      const target = targets.get(key);
      if (!target) continue;
      for (const sid of [...target.statuses.keys()].sort()) {
        const live = target.statuses.get(sid)!;
        const d = def(sid);
        if (d.period !== null && now > live.appliedAt && (now - live.appliedAt) % d.period === 0)
          events.push(
            Object.freeze({kind: 'periodic', target: key, id: sid, stacks: live.stacks, source: live.source}),
          );
        if (d.policy === 'independent') {
          let gone = 0;
          while (gone < live.timers.length && live.timers[gone]! <= now) gone++;
          if (gone) {
            live.timers.splice(0, gone);
            if (!live.timers.length) {
              end(target, key, live, 'expired', gone, events);
              continue;
            }
            live.stacks = live.timers.length;
            events.push(loss('expired', key, sid, gone, live.stacks));
          }
        }
        if (d.decay && now - live.lastChange >= d.decay.every) {
          live.lastChange = now;
          const lost = Math.min(live.stacks, d.decay.stacks);
          if (lost === live.stacks) {
            end(target, key, live, 'decayed', lost, events);
            continue;
          }
          live.stacks -= lost;
          if (d.policy === 'independent') live.timers.splice(0, lost);
          events.push(loss('decayed', key, sid, lost, live.stacks));
        }
        if (live.expiresAt !== null && live.expiresAt <= now) end(target, key, live, 'expired', live.stacks, events);
      }
      for (const [k, im] of target.immunities) if (im.until !== null && im.until <= now) target.immunities.delete(k);
      if (!target.statuses.size && !target.immunities.size) {
        targets.delete(key);
        order = null;
      }
    }
  };

  /** Run `op` on a copy of one target and publish it only when `accept` says so. */
  const draft = <T>(key: string, op: (t: Target) => T, accept: (r: T) => boolean = () => true): T => {
    const existing = targets.get(key);
    const copy = existing
      ? cloneTarget(existing)
      : {statuses: new Map<string, Live>(), immunities: new Map<string, Immunity>()};
    const result = op(copy);
    if (accept(result)) setTarget(key, copy);
    return result;
  };

  return Object.freeze({
    get now() {
      return now;
    },
    /** Apply stacks of a status. Immune, blocked (exclusive group) and capacity outcomes change nothing. */
    apply(target: string, status: string, opts?: {stacks?: number; source?: string}): ApplyResult {
      const key = targetId(target);
      const d = def(status);
      const o = optionRecord(opts, 'apply options');
      const stacks = o.stacks ?? 1;
      if (!Number.isSafeInteger(stacks) || stacks < 1 || stacks > 65535)
        throw new StatusError('stacks must be 1..65535');
      const source = o.source === undefined ? null : targetId(o.source);
      if (!targets.has(key) && targets.size >= maxTargets)
        return Object.freeze({outcome: 'capacity', events: Object.freeze([])});
      const events: StatusEvent[] = [];
      const outcome = draft(
        key,
        t => applyTo(t, key, d, stacks, source, events, 0),
        r => r === 'applied',
      );
      return Object.freeze({outcome, events: Object.freeze(outcome === 'applied' ? events : [])});
    },
    /** Remove stacks (default all). Manual removal grants no after-immunity. */
    remove(target: string, status: string, stacks?: number): readonly StatusEvent[] {
      const key = targetId(target);
      def(status);
      if (stacks !== undefined && (!Number.isSafeInteger(stacks) || stacks < 1))
        throw new StatusError('invalid stacks');
      if (!targets.get(key)?.statuses.has(status)) return Object.freeze([]);
      return draft(key, t => {
        const live = t.statuses.get(status)!;
        const events: StatusEvent[] = [];
        if (stacks === undefined || stacks >= live.stacks) end(t, key, live, 'removed', live.stacks, events);
        else {
          live.stacks -= stacks;
          live.timers.splice(0, stacks);
          events.push(loss('removed', key, status, stacks, live.stacks));
        }
        return Object.freeze(events);
      });
    },
    /** Remove every status carrying a tag (a cleanse). */
    cleanse(target: string, tag: string): readonly StatusEvent[] {
      const key = targetId(target);
      if (!isStatusId(tag)) throw new StatusError('invalid tag');
      if (!targets.has(key)) return Object.freeze([]);
      return draft(key, t => {
        const events: StatusEvent[] = [];
        for (const sid of [...t.statuses.keys()].sort())
          if (def(sid).tags.includes(tag)) {
            const live = t.statuses.get(sid)!;
            end(t, key, live, 'removed', live.stacks, events);
          }
        return Object.freeze(events);
      });
    },
    /**
     * Grant or replace a keyed immunity to ids and/or tags (≤ 64 each), for `ticks` or (null) until cleared. It
     * refuses future applications; it does not remove statuses already active (cleanse or remove them). Keys starting
     * with `after:` are reserved for after-immunities. Returns false at the target or immunity capacity.
     */
    setImmunity(
      target: string,
      immunity: {key: string; ids?: readonly string[]; tags?: readonly string[]; ticks: number | null},
    ) {
      const key = targetId(target);
      if (!immunity || typeof immunity !== 'object') throw new StatusError('immunity must be an object');
      const ik = targetId(immunity.key);
      if (ik.startsWith(AFTER)) throw new StatusError('immunity keys starting with after: are reserved');
      const list = (v: readonly string[] | undefined) => {
        if (v !== undefined && (!Array.isArray(v) || v.length > MAX_IMMUNITY_LIST))
          throw new StatusError(`immunity lists hold at most ${MAX_IMMUNITY_LIST} entries`);
        return Object.freeze([...new Set((v ?? []).map(targetId))].sort());
      };
      const idsList = list(immunity.ids),
        tags = list(immunity.tags);
      for (const sid of idsList) def(sid);
      if (!idsList.length && !tags.length) throw new StatusError('an immunity needs ids or tags');
      if (
        immunity.ticks !== null &&
        (!Number.isSafeInteger(immunity.ticks) || immunity.ticks < 1 || immunity.ticks > 2 ** 40)
      )
        throw new StatusError('immunity ticks must be an integer in 1..2^40 or null');
      const until = immunity.ticks === null ? null : now + immunity.ticks;
      if (!targets.has(key) && targets.size >= maxTargets) return false;
      return draft(
        key,
        t => {
          if (!t.immunities.has(ik) && t.immunities.size >= maxImmunities) return false;
          t.immunities.set(ik, Object.freeze({key: ik, ids: idsList, tags, until}));
          return true;
        },
        ok => ok,
      );
    },
    clearImmunity(target: string, key: string): boolean {
      const tk = targetId(target);
      if (typeof key !== 'string' || key.startsWith(AFTER)) return false;
      if (!targets.get(tk)?.immunities.has(key)) return false;
      return draft(tk, t => t.immunities.delete(key));
    },
    /** Forget a target (despawn, scene exit). No events: it is cancellation, not expiry. */
    removeTarget(target: string): boolean {
      const removed = targets.delete(targetId(target));
      if (removed) order = null;
      return removed;
    },
    /** Advance the clock by whole ticks (≤ maxAdvance), in order: periodic, timers, decay, expiry, immunities. */
    advance(ticks = 1): readonly StatusEvent[] {
      if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > maxAdvance)
        throw new StatusError(`advance takes 1..${maxAdvance} ticks`);
      if (now + ticks > MAX_NOW) throw new StatusError('clock exhausted');
      const events: StatusEvent[] = [];
      for (let i = 0; i < ticks; i++) tick(events);
      return Object.freeze(events);
    },
    stacks(target: string, status: string): number {
      def(status);
      return read(target)?.statuses.get(status)?.stacks ?? 0;
    },
    has(target: string, status: string): boolean {
      def(status);
      return (read(target)?.statuses.get(status)?.stacks ?? 0) > 0;
    },
    list(target: string): readonly StatusInstance[] {
      const t = read(target);
      if (!t) return Object.freeze([]);
      return Object.freeze([...t.statuses.keys()].sort().map(k => freezeInstance(t.statuses.get(k)!)));
    },
    immunities(target: string): readonly Immunity[] {
      const t = read(target);
      return Object.freeze(t ? [...t.immunities.keys()].sort().map(k => t.immunities.get(k)!) : []);
    },
    isImmune(target: string, status: string): boolean {
      return immuneTo(read(target), def(status));
    },
    /** Union of the flags raised by active statuses, sorted. */
    flags(target: string): readonly string[] {
      const t = read(target);
      if (!t) return Object.freeze([]);
      const set = new Set<string>();
      for (const sid of t.statuses.keys()) for (const f of def(sid).flags) set.add(f);
      return Object.freeze([...set].sort());
    },
    /**
     * Contribution rows of active statuses, `source` = `status:<id>`, in id order. Map them onto the formulas kit's
     * stacking stages or the capabilities kit's modifiers.
     */
    contributions(target: string): readonly Readonly<{key: string; value: number; source: string}>[] {
      const t = read(target);
      if (!t) return Object.freeze([]);
      const rows: Readonly<{key: string; value: number; source: string}>[] = [];
      for (const sid of [...t.statuses.keys()].sort()) {
        const live = t.statuses.get(sid)!;
        for (const c of def(sid).contributes) {
          const value = c.perStack ? c.value * live.stacks : c.value;
          if (!Number.isFinite(value)) throw new StatusError(`contribution of ${sid} overflowed`);
          rows.push(Object.freeze({key: c.key, value, source: `status:${sid}`}));
        }
      }
      return Object.freeze(rows);
    },
    targets(): readonly string[] {
      return Object.freeze([...targets.keys()].sort());
    },
    /** Detached plain data; store it in one save section with the rest of the scene's rule state. */
    snapshot(): StatusSnapshot {
      return Object.freeze({
        version: 1 as const,
        signature,
        now,
        targets: Object.freeze(
          [...targets.keys()].sort().map(key => {
            const t = targets.get(key)!;
            return Object.freeze({
              target: key,
              statuses: Object.freeze([...t.statuses.keys()].sort().map(k => freezeInstance(t.statuses.get(k)!))),
              immunities: Object.freeze([...t.immunities.keys()].sort().map(k => t.immunities.get(k)!)),
            });
          }),
        ),
      });
    },
    /** Replace all state from a snapshot of the same rules, validated completely before anything changes. */
    restore(raw: unknown): void {
      const next = parseSnapshot(raw, signature, defs, {maxTargets, maxPerTarget, maxImmunities});
      targets = next.targets;
      now = next.now;
      order = null;
    },
  });
}
export type StatusEffects = ReturnType<typeof createStatusEffects>;

function record(v: unknown, fields: readonly string[], what: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new StatusError(`${what} must be a record`);
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) throw new StatusError(`${what} must be plain data`);
  const keys = Reflect.ownKeys(v);
  if (keys.length !== fields.length || keys.some(k => typeof k !== 'string' || !fields.includes(k)))
    throw new StatusError(`${what} has unexpected fields`);
  const out: Record<string, unknown> = Object.create(null);
  for (const f of fields) {
    const d = Object.getOwnPropertyDescriptor(v, f)!;
    if (!('value' in d)) throw new StatusError(`${what} has an accessor`);
    out[f] = d.value;
  }
  return out;
}
function array(v: unknown, max: number, what: string): unknown[] {
  if (!Array.isArray(v) || v.length > max) throw new StatusError(`${what} must be an array of at most ${max}`);
  const out: unknown[] = [];
  for (let i = 0; i < v.length; i++) {
    const d = Object.getOwnPropertyDescriptor(v, String(i));
    if (!d || !('value' in d)) throw new StatusError(`${what} must be dense data`);
    out.push(d.value);
  }
  return out;
}
const tickValue = (v: unknown, what: string, max = MAX_TICK_VALUE): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > max)
    throw new StatusError(`${what} must be a tick`);
  return v;
};

function parseSnapshot(
  raw: unknown,
  signature: string,
  defs: ReadonlyMap<string, StatusDefinition>,
  b: {maxTargets: number; maxPerTarget: number; maxImmunities: number},
): {now: number; targets: Map<string, Target>} {
  const s = record(raw, ['version', 'signature', 'now', 'targets'], 'snapshot');
  if (s.version !== 1) throw new StatusError('unsupported snapshot version');
  if (s.signature !== signature) throw new StatusError('snapshot was saved with different status rules');
  const now = tickValue(s.now, 'now', MAX_NOW);
  const targets = new Map<string, Target>();
  for (const entry of array(s.targets, b.maxTargets, 'targets')) {
    const t = record(entry, ['target', 'statuses', 'immunities'], 'target');
    if (!isStatusId(t.target) || targets.has(t.target)) throw new StatusError('invalid or duplicate target');
    const statuses = new Map<string, Live>();
    for (const item of array(t.statuses, b.maxPerTarget, 'statuses')) {
      const r = record(item, ['id', 'stacks', 'appliedAt', 'lastChange', 'expiresAt', 'timers', 'source'], 'status');
      const d = typeof r.id === 'string' ? defs.get(r.id) : undefined;
      if (!d || statuses.has(d.id)) throw new StatusError('unknown or duplicate status');
      const stacks = r.stacks;
      if (typeof stacks !== 'number' || !Number.isSafeInteger(stacks) || stacks < 1 || stacks > d.maxStacks)
        throw new StatusError(`${d.id}: invalid stacks`);
      if (d.threshold && d.threshold.consume && d.threshold.become === null && stacks >= d.threshold.stacks)
        throw new StatusError(`${d.id}: stacks at a consuming threshold`);
      const appliedAt = tickValue(r.appliedAt, 'appliedAt'),
        lastChange = tickValue(r.lastChange, 'lastChange');
      if (appliedAt > now || lastChange > now || lastChange < appliedAt)
        throw new StatusError(`${d.id}: invalid ticks`);
      const expiresAt = r.expiresAt === null ? null : tickValue(r.expiresAt, 'expiresAt');
      const longest = d.duration === null ? 0 : (d.maxDuration ?? d.duration);
      if (
        (expiresAt === null) !== (d.duration === null) ||
        (expiresAt !== null && (expiresAt <= now || expiresAt > now + longest))
      )
        throw new StatusError(`${d.id}: invalid expiry`);
      const timers = array(r.timers, 256, 'timers').map(x => tickValue(x, 'timer'));
      if (d.policy === 'independent') {
        if (
          timers.length !== stacks ||
          timers.some((x, i) => x <= now || x > now + d.duration! || (i > 0 && x < timers[i - 1]!))
        )
          throw new StatusError(`${d.id}: invalid timers`);
        if (expiresAt !== timers[timers.length - 1]) throw new StatusError(`${d.id}: expiry must equal the last timer`);
      } else if (timers.length) throw new StatusError(`${d.id}: timers need the independent policy`);
      if (r.source !== null && !isStatusId(r.source)) throw new StatusError(`${d.id}: invalid source`);
      const source = r.source as string | null;
      statuses.set(d.id, {id: d.id, stacks, appliedAt, lastChange, expiresAt, timers, source});
    }
    const groups = new Set<string>();
    for (const sid of statuses.keys()) {
      const g = defs.get(sid)!.group;
      if (g !== null && groups.has(g)) throw new StatusError(`two statuses of group ${g}`);
      if (g !== null) groups.add(g);
    }
    const immunities = new Map<string, Immunity>();
    for (const item of array(t.immunities, b.maxImmunities, 'immunities')) {
      const r = record(item, ['key', 'ids', 'tags', 'until'], 'immunity');
      if (!isKey(r.key) || immunities.has(r.key)) throw new StatusError('invalid or duplicate immunity key');
      if (r.key.startsWith(AFTER) && !defs.get(r.key.slice(AFTER.length))?.afterImmunity)
        throw new StatusError('after-immunity of a status without one');
      if (!r.key.startsWith(AFTER) && !isStatusId(r.key)) throw new StatusError('invalid immunity key');
      const list = (v: unknown) => {
        const xs = array(v, MAX_IMMUNITY_LIST, 'immunity list');
        if (!xs.every(isStatusId)) throw new StatusError('invalid immunity entry');
        return Object.freeze([...new Set(xs as string[])].sort());
      };
      const ids = list(r.ids),
        tags = list(r.tags);
      if (ids.some(x => !defs.has(x))) throw new StatusError('immunity names an unknown status');
      if (!ids.length && !tags.length) throw new StatusError('empty immunity');
      const until = r.until === null ? null : tickValue(r.until, 'until');
      if (until !== null && until <= now) throw new StatusError('expired immunity');
      immunities.set(r.key, Object.freeze({key: r.key, ids, tags, until}));
    }
    if (!statuses.size && !immunities.size) throw new StatusError('empty target');
    targets.set(t.target, {statuses, immunities});
  }
  return {now, targets};
}
