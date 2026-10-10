import {isStatusId, StatusError, type StatusDefinition, type StatusRules} from './rules';

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
export type StatusEvent = Readonly<
  | {kind: 'applied' | 'stacked'; target: string; id: string; stacks: number}
  | {kind: 'periodic'; target: string; id: string; stacks: number}
  | {kind: 'expired' | 'decayed' | 'removed' | 'consumed' | 'replaced'; target: string; id: string; stacks: number}
  | {kind: 'triggered'; target: string; id: string; trigger: string; stacks: number}
  | {kind: 'transformed'; target: string; id: string; into: string}
>;
export type ApplyResult = Readonly<{
  /** applied: the status changed; immune, blocked and capacity change nothing. */
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

const MAX_TICK = 2 ** 50;
const freezeInstance = (s: Live): StatusInstance => Object.freeze({...s, timers: Object.freeze([...s.timers])});

/**
 * Status effects for many targets on one fixed clock. Every mutation validates first and applies completely; reentry
 * from creator callbacks is impossible because the owner calls none. Processing order is deterministic: targets and
 * statuses in id order.
 */
export function createStatusEffects(rules: StatusRules, options: StatusOptions = {}) {
  const defs = new Map(rules.statuses);
  const signature = rules.signature;
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
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_TICK) throw new StatusError('now must be a tick');
  let targets = new Map<string, Target>();

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
  const end = (
    target: Target,
    targetKey: string,
    live: Live,
    kind: 'expired' | 'decayed' | 'removed' | 'consumed' | 'replaced',
    events: StatusEvent[],
  ) => {
    target.statuses.delete(live.id);
    events.push(Object.freeze({kind, target: targetKey, id: live.id, stacks: live.stacks}));
    const after = def(live.id).afterImmunity;
    if (after && kind !== 'removed' && kind !== 'replaced') {
      const key = `after:${live.id}`;
      if (target.immunities.has(key) || target.immunities.size < maxImmunities)
        target.immunities.set(key, Object.freeze({key, ids: after.ids, tags: after.tags, until: now + after.ticks}));
    }
  };

  // Apply to a working copy; `depth` bounds transform chains (validated acyclic, so depth ≤ status count).
  const applyTo = (
    target: Target,
    targetKey: string,
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
          end(target, targetKey, occupant, 'replaced', events);
        }
      }
      if (target.statuses.size >= maxPerTarget) return 'capacity';
      const count = Math.min(stacks, d.maxStacks);
      const live: Live = {
        id: d.id,
        stacks: count,
        appliedAt: now,
        lastChange: now,
        expiresAt: d.duration === null ? null : now + d.duration,
        timers: d.policy === 'independent' ? Array.from({length: count}, () => now + d.duration!) : [],
        source,
      };
      target.statuses.set(d.id, live);
      events.push(Object.freeze({kind: 'applied', target: targetKey, id: d.id, stacks: count}));
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
          for (let i = 0; i < added; i++) existing.timers.push(now + d.duration);
          // At the cap, a new application refreshes the oldest timer instead of being lost.
          if (added < stacks && existing.timers.length) existing.timers[0] = now + d.duration;
          existing.timers.sort((a, b) => a - b);
          existing.expiresAt = existing.timers[existing.timers.length - 1]!;
        }
      }
      events.push(Object.freeze({kind: 'stacked', target: targetKey, id: d.id, stacks: existing.stacks}));
    }
    const live = target.statuses.get(d.id)!;
    const t = d.threshold;
    if (t && live.stacks >= t.stacks) {
      const into = t.become === null ? null : def(t.become);
      if (into && immuneTo(target, into)) return 'applied'; // capped, not transformed
      if (t.trigger !== null)
        events.push(
          Object.freeze({kind: 'triggered', target: targetKey, id: d.id, trigger: t.trigger, stacks: live.stacks}),
        );
      if (t.consume) end(target, targetKey, live, 'consumed', events);
      if (into) {
        events.push(Object.freeze({kind: 'transformed', target: targetKey, id: d.id, into: into.id}));
        applyTo(target, targetKey, into, t.becomeStacks, source, events, depth + 1);
      }
    }
    return 'applied';
  };

  const clone = (t: Target): Target => ({
    statuses: new Map([...t.statuses].map(([k, s]) => [k, {...s, timers: [...s.timers]}])),
    immunities: new Map(t.immunities),
  });
  const read = (t: unknown) => targets.get(targetId(t));

  const tick = (events: StatusEvent[]) => {
    now++;
    for (const key of [...targets.keys()].sort()) {
      const target = targets.get(key)!;
      for (const sid of [...target.statuses.keys()].sort()) {
        const live = target.statuses.get(sid);
        if (!live) continue;
        const d = def(sid);
        if (d.period !== null && now > live.appliedAt && (now - live.appliedAt) % d.period === 0)
          events.push(Object.freeze({kind: 'periodic', target: key, id: sid, stacks: live.stacks}));
        if (d.policy === 'independent') {
          let gone = 0;
          while (gone < live.timers.length && live.timers[gone]! <= now) gone++;
          if (gone) {
            live.timers.splice(0, gone);
            live.stacks = live.timers.length;
            if (!live.stacks) {
              live.stacks = gone;
              end(target, key, live, 'expired', events);
              continue;
            }
          }
        }
        if (d.decay && now - live.lastChange >= d.decay.every) {
          live.lastChange = now;
          live.stacks -= Math.min(live.stacks, d.decay.stacks);
          if (live.stacks === 0) {
            end(target, key, live, 'decayed', events);
            continue;
          }
          if (d.policy === 'independent') live.timers.splice(0, live.timers.length - live.stacks);
        }
        if (live.expiresAt !== null && live.expiresAt <= now) end(target, key, live, 'expired', events);
      }
      for (const [k, im] of target.immunities) if (im.until !== null && im.until <= now) target.immunities.delete(k);
      if (!target.statuses.size && !target.immunities.size) targets.delete(key);
    }
  };

  const mutate = <T>(targetKey: string, op: (target: Target) => T): T => {
    const existing = targets.get(targetKey);
    const draft = existing ? clone(existing) : {statuses: new Map(), immunities: new Map()};
    const result = op(draft);
    if (draft.statuses.size || draft.immunities.size) targets.set(targetKey, draft);
    else targets.delete(targetKey);
    return result;
  };

  return Object.freeze({
    get now() {
      return now;
    },
    /** Apply stacks of a status. Immune, blocked (exclusive group) and capacity outcomes change nothing. */
    apply(target: string, status: string, o: {stacks?: number; source?: string} = {}): ApplyResult {
      const key = targetId(target);
      const d = def(status);
      const stacks = o.stacks ?? 1;
      if (!Number.isSafeInteger(stacks) || stacks < 1 || stacks > 65535)
        throw new StatusError('stacks must be 1..65535');
      const source = o.source === undefined ? null : targetId(o.source);
      if (!targets.has(key) && targets.size >= maxTargets)
        return Object.freeze({outcome: 'capacity', events: Object.freeze([])});
      const existing = targets.get(key);
      const draft = existing
        ? clone(existing)
        : {statuses: new Map<string, Live>(), immunities: new Map<string, Immunity>()};
      const events: StatusEvent[] = [];
      const outcome = applyTo(draft, key, d, stacks, source, events, 0);
      if (outcome !== 'applied') return Object.freeze({outcome, events: Object.freeze([])});
      if (draft.statuses.size || draft.immunities.size) targets.set(key, draft);
      else targets.delete(key);
      return Object.freeze({outcome, events: Object.freeze(events)});
    },
    /** Remove stacks (default all). Returns the events; removing an absent status returns none. */
    remove(target: string, status: string, stacks?: number): readonly StatusEvent[] {
      const key = targetId(target);
      def(status);
      if (stacks !== undefined && (!Number.isSafeInteger(stacks) || stacks < 1))
        throw new StatusError('invalid stacks');
      if (!targets.get(key)?.statuses.has(status)) return Object.freeze([]);
      return mutate(key, t => {
        const live = t.statuses.get(status)!;
        const events: StatusEvent[] = [];
        if (stacks === undefined || stacks >= live.stacks) end(t, key, live, 'removed', events);
        else {
          live.stacks -= stacks;
          live.timers.splice(0, stacks);
          events.push(Object.freeze({kind: 'removed', target: key, id: status, stacks}));
        }
        return Object.freeze(events);
      });
    },
    /** Remove every status carrying a tag (a cleanse). */
    cleanse(target: string, tag: string): readonly StatusEvent[] {
      const key = targetId(target);
      if (!isStatusId(tag)) throw new StatusError('invalid tag');
      if (!targets.has(key)) return Object.freeze([]);
      return mutate(key, t => {
        const events: StatusEvent[] = [];
        for (const sid of [...t.statuses.keys()].sort())
          if (def(sid).tags.includes(tag)) end(t, key, t.statuses.get(sid)!, 'removed', events);
        return Object.freeze(events);
      });
    },
    /** Grant or replace a keyed immunity to ids and/or tags, for `ticks` or (null) until cleared. */
    setImmunity(
      target: string,
      immunity: {key: string; ids?: readonly string[]; tags?: readonly string[]; ticks: number | null},
    ) {
      const key = targetId(target);
      const ik = targetId(immunity.key);
      const list = (v: readonly string[] | undefined) => Object.freeze([...new Set((v ?? []).map(targetId))].sort());
      const idsList = list(immunity.ids),
        tags = list(immunity.tags);
      for (const sid of idsList) def(sid);
      if (!idsList.length && !tags.length) throw new StatusError('an immunity needs ids or tags');
      if (immunity.ticks !== null && (!Number.isSafeInteger(immunity.ticks) || immunity.ticks < 1))
        throw new StatusError('immunity ticks must be a positive integer or null');
      const until = immunity.ticks === null ? null : now + immunity.ticks;
      if (!targets.has(key) && targets.size >= maxTargets) return false;
      return mutate(key, t => {
        if (!t.immunities.has(ik) && t.immunities.size >= maxImmunities) return false;
        t.immunities.set(ik, Object.freeze({key: ik, ids: idsList, tags, until}));
        return true;
      });
    },
    clearImmunity(target: string, key: string): boolean {
      const tk = targetId(target);
      if (!targets.get(tk)?.immunities.has(key)) return false;
      return mutate(tk, t => t.immunities.delete(key));
    },
    /** Forget a target (despawn, scene exit). No events: it is cancellation, not expiry. */
    removeTarget(target: string): boolean {
      return targets.delete(targetId(target));
    },
    /** Advance the clock by whole ticks (≤ maxAdvance), in order: periodic, timers, decay, expiry, immunities. */
    advance(ticks = 1): readonly StatusEvent[] {
      if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > maxAdvance)
        throw new StatusError(`advance takes 1..${maxAdvance} ticks`);
      if (now + ticks > MAX_TICK) throw new StatusError('clock exhausted');
      const saved = targets;
      const savedNow = now;
      targets = new Map([...targets].map(([k, t]) => [k, clone(t)]));
      const events: StatusEvent[] = [];
      try {
        for (let i = 0; i < ticks; i++) tick(events);
      } catch (error) {
        targets = saved;
        now = savedNow;
        throw error;
      }
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
const tick = (v: unknown, what: string): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > MAX_TICK)
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
  const now = tick(s.now, 'now');
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
      const appliedAt = tick(r.appliedAt, 'appliedAt'),
        lastChange = tick(r.lastChange, 'lastChange');
      if (appliedAt > now || lastChange > now || lastChange < appliedAt)
        throw new StatusError(`${d.id}: invalid ticks`);
      const expiresAt = r.expiresAt === null ? null : tick(r.expiresAt, 'expiresAt');
      if ((expiresAt === null) !== (d.duration === null) || (expiresAt !== null && expiresAt <= now))
        throw new StatusError(`${d.id}: invalid expiry`);
      const timers = array(r.timers, 256, 'timers').map(x => tick(x, 'timer'));
      if (d.policy === 'independent') {
        if (timers.length !== stacks || timers.some((x, i) => x <= now || (i > 0 && x < timers[i - 1]!)))
          throw new StatusError(`${d.id}: invalid timers`);
        if (expiresAt !== timers[timers.length - 1]) throw new StatusError(`${d.id}: expiry must equal the last timer`);
      } else if (timers.length) throw new StatusError(`${d.id}: timers need the independent policy`);
      const source = r.source === null ? null : isStatusId(r.source) ? r.source : null;
      if (r.source !== null && source === null) throw new StatusError(`${d.id}: invalid source`);
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
      if (!isStatusId(r.key) || immunities.has(r.key)) throw new StatusError('invalid or duplicate immunity key');
      const list = (v: unknown) => {
        const xs = array(v, 64, 'immunity list');
        if (!xs.every(isStatusId)) throw new StatusError('invalid immunity entry');
        return Object.freeze([...new Set(xs as string[])].sort());
      };
      const ids = list(r.ids),
        tags = list(r.tags);
      if (ids.some(x => !defs.has(x))) throw new StatusError('immunity names an unknown status');
      if (!ids.length && !tags.length) throw new StatusError('empty immunity');
      const until = r.until === null ? null : tick(r.until, 'until');
      if (until !== null && until <= now) throw new StatusError('expired immunity');
      immunities.set(r.key, Object.freeze({key: r.key, ids, tags, until}));
    }
    if (!statuses.size && !immunities.size) throw new StatusError('empty target');
    targets.set(t.target, {statuses, immunities});
  }
  return {now, targets};
}
