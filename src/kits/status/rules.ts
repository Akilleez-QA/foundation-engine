/** Status rules: validated, frozen data. Durations and periods are integer ticks of the caller's fixed clock. */

export class StatusError extends Error {
  constructor(message: string) {
    super(`status: ${message}`);
    this.name = 'StatusError';
  }
}

/**
 * What re-applying an active status does to its timer.
 *   refresh      reset the expiry to now + duration
 *   extend       add duration to the remaining time, capped at maxDuration
 *   keep         leave the first application's expiry
 *   independent  every stack has its own timer and expires on its own
 */
export type DurationPolicy = 'refresh' | 'extend' | 'keep' | 'independent';

export interface StatusContribution {
  /** Creator vocabulary: a stat, a stacking stage of the formulas kit, a resistance key… */
  readonly key: string;
  readonly value: number;
  /** Multiply the value by the current stack count. */
  readonly perStack?: boolean;
}
export interface StatusThreshold {
  /** Reaching this many stacks fires the threshold. */
  readonly stacks: number;
  /** Become another status (applied with `becomeStacks`, default 1). Refused while the target is immune to it. */
  readonly become?: string;
  readonly becomeStacks?: number;
  /** Emit a `triggered` event with this name (an explosion, a shatter: the game resolves the consequence). */
  readonly trigger?: string;
  /** Remove this status when the threshold fires (default true). */
  readonly consume?: boolean;
}
export interface StatusDefinitionInput {
  readonly id: string;
  /** Stack cap: 1–65,535 (1–256 with independent timers). Default 1. */
  readonly maxStacks?: number;
  /** Ticks until expiry, or null for a status that lasts until removed. Default null. */
  readonly duration?: number | null;
  readonly policy?: DurationPolicy;
  /** For `extend`: the longest remaining time. Default: duration. */
  readonly maxDuration?: number;
  /** Lose `stacks` every `every` ticks after the last application; removed at zero. */
  readonly decay?: {readonly every: number; readonly stacks: number};
  /** Emit a `periodic` event every `period` ticks after application (damage or healing over time, in the game). */
  readonly period?: number;
  readonly threshold?: StatusThreshold;
  /** Tags for cleansing and tag immunity (`debuff`, `cold`…). */
  readonly tags?: readonly string[];
  /** Exclusive group: at most one status of a group on a target. */
  readonly group?: string;
  /** What applying a different status of an occupied group does: refuse it (default) or replace the occupant. */
  readonly groupPolicy?: 'block' | 'replace';
  /** Flags the status raises while active (creator vocabulary: `rooted`, `silenced`…). */
  readonly flags?: readonly string[];
  readonly contributes?: readonly StatusContribution[];
  /** When the status ends by expiry, decay or threshold consumption, grant this immunity. */
  readonly afterImmunity?: {
    readonly ids?: readonly string[];
    readonly tags?: readonly string[];
    readonly ticks: number;
  };
}
export interface StatusDefinition {
  readonly id: string;
  readonly maxStacks: number;
  readonly duration: number | null;
  readonly policy: DurationPolicy;
  readonly maxDuration: number | null;
  readonly decay: {readonly every: number; readonly stacks: number} | null;
  readonly period: number | null;
  readonly threshold:
    | (Required<Omit<StatusThreshold, 'become' | 'trigger'>> & {
        readonly become: string | null;
        readonly trigger: string | null;
      })
    | null;
  readonly tags: readonly string[];
  readonly group: string | null;
  readonly groupPolicy: 'block' | 'replace';
  readonly flags: readonly string[];
  readonly contributes: readonly Required<StatusContribution>[];
  readonly afterImmunity: {
    readonly ids: readonly string[];
    readonly tags: readonly string[];
    readonly ticks: number;
  } | null;
}
export interface StatusRules {
  readonly statuses: ReadonlyMap<string, StatusDefinition>;
  /** Stable text of the normalized rules; snapshots record it and restore refuses a different one. */
  readonly signature: string;
}

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
export const isStatusId = (v: unknown): v is string => typeof v === 'string' && ID.test(v);
const id = (v: unknown, what: string): string => {
  if (!isStatusId(v)) throw new StatusError(`invalid ${what} ${JSON.stringify(v)}`);
  return v;
};
const int = (v: unknown, min: number, max: number, what: string): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max)
    throw new StatusError(`${what} must be an integer in ${min}..${max}`);
  return v;
};
const ids = (v: unknown, what: string, max = 32): readonly string[] => {
  if (v === undefined) return Object.freeze([]);
  if (!Array.isArray(v) || v.length > max) throw new StatusError(`${what} must be an array of at most ${max}`);
  const out = [...new Set(v.map(x => id(x, what)))].sort();
  return Object.freeze(out);
};
const MAX_TICKS = 2 ** 40;

/** Validate status definitions. Threshold `become` targets must exist and must not form a cycle. */
export function defineStatusRules(input: readonly StatusDefinitionInput[]): StatusRules {
  if (!Array.isArray(input) || input.length < 1 || input.length > 256)
    throw new StatusError('rules need 1..256 status definitions');
  const map = new Map<string, StatusDefinition>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') throw new StatusError('a status definition must be an object');
    const sid = id(raw.id, 'status id');
    if (map.has(sid)) throw new StatusError(`duplicate status ${sid}`);
    const policy = raw.policy ?? 'refresh';
    if (!['refresh', 'extend', 'keep', 'independent'].includes(policy)) throw new StatusError(`${sid}: invalid policy`);
    const maxStacks = int(raw.maxStacks ?? 1, 1, policy === 'independent' ? 256 : 65535, `${sid} maxStacks`);
    const duration =
      raw.duration === undefined || raw.duration === null ? null : int(raw.duration, 1, MAX_TICKS, `${sid} duration`);
    if (policy === 'independent' && duration === null)
      throw new StatusError(`${sid}: independent timers need a duration`);
    if (policy === 'extend' && duration === null) throw new StatusError(`${sid}: extend needs a duration`);
    const maxDuration =
      policy === 'extend' ? int(raw.maxDuration ?? duration, duration!, MAX_TICKS, `${sid} maxDuration`) : null;
    if (raw.maxDuration !== undefined && policy !== 'extend') throw new StatusError(`${sid}: maxDuration needs extend`);
    const decay = raw.decay
      ? Object.freeze({
          every: int(raw.decay.every, 1, MAX_TICKS, `${sid} decay.every`),
          stacks: int(raw.decay.stacks, 1, 65535, `${sid} decay.stacks`),
        })
      : null;
    const period = raw.period === undefined ? null : int(raw.period, 1, MAX_TICKS, `${sid} period`);
    let threshold: StatusDefinition['threshold'] = null;
    if (raw.threshold) {
      const t = raw.threshold;
      const become = t.become === undefined ? null : id(t.become, `${sid} threshold.become`);
      const trigger = t.trigger === undefined ? null : id(t.trigger, `${sid} threshold.trigger`);
      if (become === null && trigger === null) throw new StatusError(`${sid}: a threshold needs become or trigger`);
      if (become === sid) throw new StatusError(`${sid}: a status cannot become itself`);
      threshold = Object.freeze({
        stacks: int(t.stacks, 1, maxStacks, `${sid} threshold.stacks`),
        become,
        becomeStacks: int(t.becomeStacks ?? 1, 1, 65535, `${sid} threshold.becomeStacks`),
        trigger,
        consume: t.consume ?? true,
      });
      if (typeof threshold.consume !== 'boolean') throw new StatusError(`${sid}: consume must be boolean`);
    }
    const contributes = (() => {
      if (raw.contributes === undefined) return Object.freeze([]);
      if (!Array.isArray(raw.contributes) || raw.contributes.length > 32)
        throw new StatusError(`${sid}: at most 32 contributions`);
      return Object.freeze(
        raw.contributes.map((c: StatusContribution) => {
          if (typeof c.value !== 'number' || !Number.isFinite(c.value))
            throw new StatusError(`${sid}: contribution value`);
          const perStack = c.perStack ?? false;
          if (typeof perStack !== 'boolean') throw new StatusError(`${sid}: perStack must be boolean`);
          return Object.freeze({key: id(c.key, `${sid} contribution key`), value: c.value, perStack});
        }),
      );
    })();
    const after = raw.afterImmunity
      ? Object.freeze({
          ids: ids(raw.afterImmunity.ids, `${sid} afterImmunity.ids`),
          tags: ids(raw.afterImmunity.tags, `${sid} afterImmunity.tags`),
          ticks: int(raw.afterImmunity.ticks, 1, MAX_TICKS, `${sid} afterImmunity.ticks`),
        })
      : null;
    const groupPolicy = raw.groupPolicy ?? 'block';
    if (groupPolicy !== 'block' && groupPolicy !== 'replace') throw new StatusError(`${sid}: invalid groupPolicy`);
    map.set(
      sid,
      Object.freeze({
        id: sid,
        maxStacks,
        duration,
        policy,
        maxDuration,
        decay,
        period,
        threshold,
        tags: ids(raw.tags, `${sid} tags`),
        group: raw.group === undefined ? null : id(raw.group, `${sid} group`),
        groupPolicy,
        flags: ids(raw.flags, `${sid} flags`),
        contributes,
        afterImmunity: after,
      }),
    );
  }
  for (const def of map.values()) {
    const become = def.threshold?.become;
    if (become && !map.has(become)) throw new StatusError(`${def.id}: threshold becomes unknown status ${become}`);
    for (const target of def.afterImmunity?.ids ?? [])
      if (!map.has(target)) throw new StatusError(`${def.id}: afterImmunity names unknown status ${target}`);
  }
  // Transform chains must end: walk each chain and refuse a revisit.
  for (const start of map.keys()) {
    const seen = new Set<string>();
    for (let at: string | null = start; at; at = map.get(at)!.threshold?.become ?? null) {
      if (seen.has(at)) throw new StatusError(`threshold transforms form a cycle through ${at}`);
      seen.add(at);
    }
  }
  const ordered = [...map.keys()].sort();
  const statuses = new Map(ordered.map(k => [k, map.get(k)!]));
  return Object.freeze({statuses, signature: JSON.stringify([...statuses.values()])});
}
