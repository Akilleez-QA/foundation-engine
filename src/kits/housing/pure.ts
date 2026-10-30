export type Permission = 'enter' | 'decorate' | 'store' | 'manage';
export interface Placement {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
}
export interface StructureSnapshot {
  revision: number;
  owner: string;
  grants: Record<string, Permission[]>;
  placements: Placement[];
  occupants: string[];
  packed: boolean;
}
/** Local property authority. Terrain adapters return support height and exclusion at bounded footprint samples. */
export function createStructure(initial: StructureSnapshot, limit = 128) {
  const state = structuredClone(initial),
    validId = (id: string) => typeof id === 'string' && id.length > 0;
  if (
    !validId(state.owner) ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    state.occupants.length > limit ||
    Object.keys(state.grants).length > limit ||
    state.placements.length > limit ||
    new Set(state.placements.map(p => p.id)).size !== state.placements.length ||
    new Set(state.occupants).size !== state.occupants.length ||
    typeof state.packed !== 'boolean'
  )
    throw Error('housing: invalid snapshot');
  const permissions: Permission[] = ['enter', 'decorate', 'store', 'manage'];
  for (const [id, grants] of Object.entries(state.grants))
    if (!validId(id) || !Array.isArray(grants) || grants.some(p => !permissions.includes(p)))
      throw Error('housing: invalid grant');
  const validPlacement = (p: Placement) =>
    validId(p.id) &&
    [p.x, p.z, p.width, p.depth, p.height].every(Number.isFinite) &&
    p.width > 0 &&
    p.depth > 0 &&
    [p.x - p.width / 2, p.x + p.width / 2, p.z - p.depth / 2, p.z + p.depth / 2].every(Number.isFinite);
  if (
    state.placements.some(p => !validPlacement(p)) ||
    state.occupants.some(id => !validId(id)) ||
    (state.packed && state.occupants.length)
  )
    throw Error('housing: invalid contents');
  for (let i = 0; i < state.placements.length; i++)
    for (let j = 0; j < i; j++) {
      const p = state.placements[i]!,
        q = state.placements[j]!;
      /* j < i < length */ if (
        Math.abs(q.x - p.x) < q.width / 2 + p.width / 2 &&
        Math.abs(q.z - p.z) < q.depth / 2 + p.depth / 2
      )
        throw Error('housing: overlapping saved placements');
    }
  const can = (actor: string, permission: Permission) =>
    !state.packed &&
    (actor === state.owner || Boolean(Object.hasOwn(state.grants, actor) && state.grants[actor]!.includes(permission)));
  const advance = () => {
    if (state.revision === Number.MAX_SAFE_INTEGER) throw Error('housing: revision exhausted');
  };
  return {
    can,
    grant(actor: string, member: string, grants: Permission[]) {
      if (
        !can(actor, 'manage') ||
        !validId(member) ||
        (!Object.hasOwn(state.grants, member) && Object.keys(state.grants).length >= limit) ||
        grants.some(p => !permissions.includes(p))
      )
        return false;
      advance();
      Object.defineProperty(state.grants, member, {
        value: [...new Set(grants)],
        enumerable: true,
        writable: true,
        configurable: true,
      });
      state.revision++;
      return true;
    },
    enter(actor: string) {
      if (!can(actor, 'enter')) return false;
      if (state.occupants.includes(actor)) return true;
      if (state.occupants.length >= limit) return false;
      advance();
      state.occupants.push(actor);
      state.revision++;
      return true;
    },
    leave(actor: string) {
      const i = state.occupants.indexOf(actor);
      if (i < 0) return false;
      advance();
      state.occupants.splice(i, 1);
      state.revision++;
      return true;
    },
    place(
      actor: string,
      p: Placement,
      expected: number,
      sample: (x: number, z: number) => {height: number; excluded: boolean} | null,
      spacing = 1,
      maxSlope = 0.2,
    ): boolean {
      p = structuredClone(p);
      if (
        !can(actor, 'decorate') ||
        expected !== state.revision ||
        !validPlacement(p) ||
        state.placements.length >= limit ||
        state.placements.some(q => q.id === p.id)
      )
        return false;
      if (!Number.isFinite(spacing) || spacing <= 0 || !Number.isFinite(maxSlope) || maxSlope < 0)
        throw Error('housing: invalid placement policy');
      const nx = Math.max(1, Math.ceil(p.width / spacing)),
        nz = Math.max(1, Math.ceil(p.depth / spacing));
      if ((nx + 1) * (nz + 1) > 4096) return false;
      if (
        state.placements.some(
          q => Math.abs(q.x - p.x) < q.width / 2 + p.width / 2 && Math.abs(q.z - p.z) < q.depth / 2 + p.depth / 2,
        )
      )
        return false;
      let low = Infinity,
        high = -Infinity;
      for (let x = 0; x <= nx; x++)
        for (let z = 0; z <= nz; z++) {
          const s = sample(p.x - p.width / 2 + p.width * (x / nx), p.z - p.depth / 2 + p.depth * (z / nz));
          if (!s || s.excluded || !Number.isFinite(s.height)) return false;
          low = Math.min(low, s.height);
          high = Math.max(high, s.height);
        }
      if (
        high - low > maxSlope ||
        Math.abs(p.height - high) > 1e-6 ||
        expected !== state.revision ||
        !can(actor, 'decorate')
      )
        return false;
      advance();
      state.placements.push(structuredClone(p));
      state.revision++;
      return true;
    },
    /** Refuse destruction with occupants. Packed contents stay in the recoverable manifest. */
    pack(actor: string, expected: number): StructureSnapshot | null {
      if (!can(actor, 'manage') || expected !== state.revision || state.occupants.length) return null;
      advance();
      state.packed = true;
      state.revision++;
      return structuredClone(state);
    },
    snapshot: (): StructureSnapshot => structuredClone(state),
  };
}
