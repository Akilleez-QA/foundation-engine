/**
 * Cast binding for a sequence: which entities play which roles, which of their channels the sequence drives, and
 * which other entities are frozen while it runs.
 *
 * A cast definition names roles and, for each role, the channels the sequence takes over (creator strings such as
 * `position`, `rotation`, `clip`, `ai`). At start the caller resolves each role to an entity. Gameplay systems then
 * ask `drives(entity, channel)` and skip writing what the sequence owns, while still running everything else for that
 * entity. `gate(entity)` tells any system whether a non-participant should update (`run`) or hold (`freeze`); entities
 * that were mid-action when the freeze was requested keep running until the caller reports them settled, and
 * `ready()` reports when everyone is held, so a sequence can wait before its first cue. Pure bookkeeping: no
 * entities are created, moved or saved by this helper.
 */
export interface CastRole {
  readonly role: string;
  /** Channels the sequence drives for this role (1-16 creator names). */
  readonly channels: readonly string[];
  /** `required` (default) refuses to start without an entity; `optional` plays without one. */
  readonly need?: 'required' | 'optional';
}
export interface CastDefinition {
  readonly id: string;
  /** 1-32 roles. */
  readonly roles: readonly CastRole[];
}
export const CAST_LIMITS = Object.freeze({roles: 32, channels: 16, idLength: 256, exempt: 256, settling: 4096});

function fail(message: string): never {
  throw new RangeError(`cast: ${message}`);
}
const isId = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= CAST_LIMITS.idLength;
const isEntity = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** Validate, copy and freeze a cast definition. */
export function defineCast(input: CastDefinition): CastDefinition {
  if (!input || typeof input !== 'object') fail('definition must be an object');
  const id = input.id,
    rolesIn = input.roles;
  if (!isId(id)) fail('definition id must be 1-256 characters');
  if (!Array.isArray(rolesIn)) fail('roles must be an array');
  const n = rolesIn.length;
  if (n < 1 || n > CAST_LIMITS.roles) fail(`a cast has 1-${CAST_LIMITS.roles} roles`);
  const seen = new Set<string>();
  const roles: CastRole[] = [];
  for (let i = 0; i < n; i++) {
    const r = (rolesIn as readonly CastRole[])[i];
    if (!r || typeof r !== 'object') fail('a role must be an object');
    const role = r.role,
      channelsIn = r.channels,
      need = r.need ?? 'required';
    if (!isId(role) || seen.has(role)) fail('role names must be unique, 1-256 characters');
    seen.add(role);
    if (need !== 'required' && need !== 'optional') fail(`${role}: need is required or optional`);
    if (!Array.isArray(channelsIn)) fail(`${role}: channels must be an array`);
    const m = channelsIn.length;
    if (m < 1 || m > CAST_LIMITS.channels) fail(`${role}: 1-${CAST_LIMITS.channels} channels`);
    const channels: string[] = [];
    for (let k = 0; k < m; k++) {
      const c: unknown = (channelsIn as readonly unknown[])[k];
      if (!isId(c) || channels.includes(c)) fail(`${role}: channel names must be unique, 1-256 characters`);
      channels.push(c);
    }
    roles.push(Object.freeze({role, channels: Object.freeze(channels), need}));
  }
  return Object.freeze({id, roles: Object.freeze(roles)});
}

export type CastStart =
  | {readonly status: 'started'}
  | {readonly status: 'missing'; readonly roles: readonly string[]}
  | {readonly status: 'conflict'; readonly entity: number; readonly roles: readonly string[]};

/**
 * One performance of a cast. `exempt` entities (for example the camera rig, UI or the entity carried by a cast
 * member) are never frozen. `freeze: false` binds roles without freezing anyone else.
 */
export function createCast(def: CastDefinition, options: {readonly freeze?: boolean} = {}) {
  if (!def || !Array.isArray(def.roles) || !Object.isFrozen(def)) fail('use defineCast for the definition');
  const freezeOthers = options.freeze ?? true;
  let state: 'idle' | 'active' | 'released' = 'idle';
  const byRole = new Map<string, number>(),
    channelsOf = new Map<number, Set<string>>(),
    exempt = new Set<number>(),
    settling = new Set<number>();
  const roleOf = (name: string) => {
    const r = def.roles.find(x => x.role === name);
    if (!r) fail(`unknown role ${String(name)}`);
    return r;
  };
  return {
    definition: def,
    /**
     * Bind roles to entities and begin. `resolve(role)` returns an entity id or null. Refuses (and binds nothing) when
     * a required role is missing or one entity would play two roles. `busy` lists entities that are mid-action now:
     * they keep running until `settled(entity)`.
     */
    start(
      resolve: (role: string) => number | null,
      extra: {readonly exempt?: readonly number[]; readonly busy?: readonly number[]} = {},
    ): CastStart {
      if (state !== 'idle') fail('a cast starts once');
      const bound = new Map<string, number>(),
        missing: string[] = [],
        owner = new Map<number, string[]>();
      for (const r of def.roles) {
        const e = resolve(r.role);
        if (e === null) {
          if (r.need === 'required') missing.push(r.role);
          continue;
        }
        if (!isEntity(e)) fail(`role ${r.role} resolved to an invalid entity`);
        bound.set(r.role, e);
        owner.set(e, [...(owner.get(e) ?? []), r.role]);
      }
      if (missing.length) return Object.freeze({status: 'missing', roles: Object.freeze(missing)});
      for (const [e, roles] of owner)
        if (roles.length > 1) return Object.freeze({status: 'conflict', entity: e, roles: Object.freeze(roles)});
      const copy = (v: readonly number[] | undefined, max: number, what: string): number[] => {
        if (v === undefined) return [];
        if (!Array.isArray(v)) fail(`${what} must be an array`);
        const n = v.length;
        if (n > max) fail(`at most ${max} ${what} entities`);
        const out: number[] = [];
        for (let i = 0; i < n; i++) out.push(v[i]!);
        return out;
      };
      const ex = copy(extra.exempt, CAST_LIMITS.exempt, 'exempt'),
        busy = copy(extra.busy, CAST_LIMITS.settling, 'busy');
      for (const e of [...ex, ...busy]) if (!isEntity(e)) fail('exempt and busy entries must be entity ids');
      for (const [role, e] of bound) {
        byRole.set(role, e);
        channelsOf.set(e, new Set(roleOf(role).channels));
      }
      for (const e of ex) exempt.add(e);
      for (const e of busy) if (!channelsOf.has(e) && !exempt.has(e)) settling.add(e);
      state = 'active';
      return Object.freeze({status: 'started'});
    },
    /** The entity playing `role`, or null (unbound optional role, or not active). */
    entity(role: string): number | null {
      roleOf(role);
      return state === 'active' ? (byRole.get(role) ?? null) : null;
    },
    /** True while the sequence owns `channel` of `entity`: gameplay should not write it. */
    drives(entity: number, channel: string): boolean {
      return state === 'active' && (channelsOf.get(entity)?.has(channel) ?? false);
    },
    /**
     * `run` or `freeze` for any entity: cast members, exempt entities and still-settling entities run; everyone else
     * is held while the cast is active (unless created with `freeze: false`).
     */
    gate(entity: number): 'run' | 'freeze' {
      if (state !== 'active' || !freezeOthers) return 'run';
      if (channelsOf.has(entity) || exempt.has(entity) || settling.has(entity)) return 'run';
      return 'freeze';
    },
    /** A busy entity finished its current action (for example reached its cell or ended its attack). */
    settled(entity: number): boolean {
      return settling.delete(entity);
    },
    /** True once no busy entity is still settling: everyone outside the cast is held. */
    ready(): boolean {
      return state === 'active' && settling.size === 0;
    },
    /**
     * End the performance (on finish, skip or cancel). Returns each bound entity with the channels it gets back, so
     * gameplay can re-sync them; later calls return nothing and every query answers as if no cast were active.
     */
    release(): readonly {readonly entity: number; readonly role: string; readonly channels: readonly string[]}[] {
      if (state !== 'active') {
        state = 'released';
        return Object.freeze([]);
      }
      state = 'released';
      const out = [...byRole].map(([role, entity]) => Object.freeze({entity, role, channels: roleOf(role).channels}));
      byRole.clear();
      channelsOf.clear();
      exempt.clear();
      settling.clear();
      return Object.freeze(out);
    },
    get status() {
      return state;
    },
  };
}
export type Cast = ReturnType<typeof createCast>;
