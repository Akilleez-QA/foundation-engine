/**
 * author/light-slots.ts: which entity's light holds which slot (VIS-02), and which slots cast shadows (VIS-03). Pure:
 * no three.js, run by the scene runtime once per frame and by `testScene` after each frame, so headless tests see the
 * same admission and refusals.
 *
 * Rules (deterministic, never re-chosen per frame):
 *  - a light holds its slot until its entity loses the light component or its `Transform` (despawn included); the slot
 *    then drops to intensity 0 and is free;
 *  - lights waiting for a slot are admitted essential first, then in entity order (spawn order), into the lowest free
 *    slot; an admitted light is never moved to another slot or evicted;
 *  - a light with no free slot is refused (cause `full`) and admitted later if a slot frees; invalid data (a system
 *    wrote a value out of range) is refused (cause `invalid`) and its slot, if it had one, goes dark until fixed;
 *  - a scene without `sceneLights()` refuses every light (cause `no-slots`);
 *  - shadows: the first `shadowed[kind]` slots of each kind cast shadows for the whole visit (so the shadow count
 *    compiled into programs never changes). A light with `shadow: true` takes a free shadowed slot; when none is free
 *    it takes a plain slot and casts no shadow (cause `shadow`). A light without `shadow` never takes a shadowed slot.
 *    In a scene without `sceneShadows()` a shadow request draws the light without a shadow (cause `no-shadows`);
 *  - each cause is reported once per visit; the counters count lights (every light refused now), not reports.
 */
import type {ComponentType, Entity, World} from '../core/ecs/world';
import {
  PointLight,
  pointLightKey,
  SpotLight,
  spotLightKey,
  validatePointLight,
  validateSpotLight,
  type PointLightData,
  type SceneLightLimits,
  type SpotLightData,
} from './lights';

export type LightKind = 'point' | 'spot';
export type LightRefusal = 'full' | 'invalid' | 'no-slots' | 'shadow' | 'no-shadows';

export interface LightStats {
  /** Slots created for this visit (fixed). */
  readonly slots: Readonly<SceneLightLimits>;
  /** Of those, the slots that cast shadows (fixed for the visit; the first ones of each kind). */
  readonly shadowed: Readonly<SceneLightLimits>;
  /** Lights holding a slot now. */
  admitted: {point: number; spot: number};
  /** How many lights are refused now (or, for `shadow` and `no-shadows`, drawn without the shadow they asked for), by
   *  cause. One per light, every frame it stays refused; the report is separate and once per cause per visit. */
  refused: Record<LightRefusal, number>;
  /** Causes reported so far (each once per visit). */
  reported: LightRefusal[];
}

interface Kind<D extends object> {
  readonly type: ComponentType<D>;
  readonly validate: (d: D) => void;
  /** Every field validation reads: a light whose key is unchanged is not validated again. */
  readonly key: (d: D) => string;
  readonly holders: (Entity | null)[];
  /** Holders [0, shadowed) cast shadows. */
  readonly shadowed: number;
}

/** A slot's light for this frame: the entity and its data, or null for a dark slot. */
export interface SlotLight<D> {
  readonly entity: Entity;
  readonly data: D;
}

type Light = PointLightData | SpotLightData;
const LABEL: Record<LightKind, string> = {point: 'PointLight', spot: 'SpotLight'};
const NO_SLOTS = {point: 0, spot: 0} as const;
const wantsShadow = (d: Light) => d.shadow === true;
const byPriority = (a: {entity: Entity; data: Light}, b: {entity: Entity; data: Light}) =>
  Number(b.data.essential === true) - Number(a.data.essential === true) || a.entity - b.entity;

/**
 * How many slots of each kind cast shadows for this visit: the lights in `world` now (the scene's own entities when the
 * visit starts) that ask for one, essential first, then in entity order, up to `cap` local shadowed lights in all and
 * at most the kind's slots. Decided once; never re-chosen.
 */
export function shadowedSlotsFor(world: World, slots: SceneLightLimits, cap: number): SceneLightLimits {
  const asking: {entity: Entity; data: Light; kind: LightKind}[] = [];
  for (const [entity, data] of world.query(PointLight))
    if (wantsShadow(data)) asking.push({entity, data, kind: 'point'});
  for (const [entity, data] of world.query(SpotLight)) if (wantsShadow(data)) asking.push({entity, data, kind: 'spot'});
  asking.sort(byPriority);
  const out = {point: 0, spot: 0};
  for (const a of asking) {
    if (out.point + out.spot >= cap) break;
    if (out[a.kind] < slots[a.kind]) out[a.kind]++;
  }
  return out;
}

export function createLightSlots(o: {
  slots: SceneLightLimits;
  /** The scene asked for slots (`sceneLights()`); false refuses every light with `no-slots`. */
  enabled: boolean;
  /** Shadowed slots of each kind (`shadowedSlotsFor`); default none. */
  shadowed?: SceneLightLimits;
  /** The scene opted into shadows (`sceneShadows()`); false reports shadow requests with `no-shadows`. */
  shadows?: boolean;
  report: (message: string) => void;
}) {
  const shadowed = o.shadowed ?? NO_SLOTS;
  const point: Kind<PointLightData> = {
      type: PointLight,
      validate: validatePointLight,
      key: d => `${pointLightKey(d)}|${d.essential}|${d.shadow}`,
      holders: Array.from({length: o.slots.point}, () => null),
      shadowed: Math.min(shadowed.point, o.slots.point),
    },
    spot: Kind<SpotLightData> = {
      type: SpotLight,
      validate: validateSpotLight,
      key: d => `${spotLightKey(d)}|${d.essential}|${d.shadow}`,
      holders: Array.from({length: o.slots.spot}, () => null),
      shadowed: Math.min(shadowed.spot, o.slots.spot),
    };
  const kinds = {point, spot};
  const empty = (): Record<LightRefusal, number> => ({full: 0, invalid: 0, 'no-slots': 0, shadow: 0, 'no-shadows': 0});
  const stats: LightStats = {
    slots: Object.freeze({...o.slots}),
    shadowed: Object.freeze({point: point.shadowed, spot: spot.shadowed}),
    admitted: {point: 0, spot: 0},
    refused: empty(),
    reported: [],
  };
  const refusal = (cause: LightRefusal, detail: string, lights = 1) => {
    stats.refused[cause] += lights;
    if (stats.reported.includes(cause)) return;
    stats.reported.push(cause);
    o.report(detail);
  };
  // Validation is cached per data object and its key: an unchanged light is not revalidated every frame.
  const checked = new WeakMap<object, string>();
  const valid = <D extends object>(kind: Kind<D>, data: D): boolean => {
    let sig: string;
    try {
      sig = kind.key(data);
    } catch {
      sig = '';
    }
    if (sig && checked.get(data) === sig) return true;
    try {
      kind.validate(data);
    } catch (error) {
      checked.delete(data);
      refusal('invalid', error instanceof Error ? error.message : String(error));
      return false;
    }
    checked.set(data, sig);
    return true;
  };
  const transform = {id: 'transform'} as ComponentType<object>;
  const free = (holders: (Entity | null)[], from: number, to: number) => {
    for (let i = from; i < to; i++) if (holders[i] === null) return i;
    return -1;
  };
  const syncKind = <D extends Light>(world: World, name: LightKind, kind: Kind<D>) => {
    const holders = kind.holders;
    const held = new Map<Entity, number>();
    holders.forEach((e, i) => {
      if (e !== null) held.set(e, i);
    });
    const waiting: {entity: Entity; data: D}[] = [];
    const present = new Set<Entity>();
    for (const [entity, data] of world.query(kind.type)) {
      if (!world.has(entity, transform)) continue;
      present.add(entity);
      if (!valid(kind, data)) continue;
      const at = held.get(entity);
      if (at === undefined) waiting.push({entity, data});
      else if (wantsShadow(data) && at >= kind.shadowed)
        // Admitted without a shadow: still counted, so the report and the counters stay true while it shines.
        stats.refused[o.shadows ? 'shadow' : 'no-shadows']++;
    }
    // Release slots whose entity left (despawned, or lost its light or Transform).
    for (const [entity, i] of held) if (!present.has(entity)) holders[i] = null;
    if (!o.enabled) {
      if (waiting.length)
        refusal(
          'no-slots',
          `a ${LABEL[name]} is not drawn: the scene has no light slots (defineScene({ lights: sceneLights() }))`,
          waiting.length,
        );
      return;
    }
    waiting.sort(byPriority);
    let full = 0;
    for (const w of waiting) {
      const shadow = wantsShadow(w.data);
      let slot = shadow ? free(holders, 0, kind.shadowed) : -1;
      if (slot < 0) slot = free(holders, kind.shadowed, holders.length);
      if (slot < 0) {
        full++;
        continue;
      }
      holders[slot] = w.entity;
      if (shadow && slot >= kind.shadowed) {
        if (o.shadows)
          refusal(
            'shadow',
            `a ${LABEL[name]} casts no shadow: no shadowed ${name} slot is free (the scene's own shadow lights hold ${kind.shadowed}; the lights.shadowed-max quality knob bounds them)`,
          );
        else
          refusal(
            'no-shadows',
            `a ${LABEL[name]} casts no shadow: the scene has no shadows (defineScene({ shadows: sceneShadows() }))`,
          );
      }
    }
    if (full)
      refusal(
        'full',
        `${full} ${LABEL[name]}(s) not drawn: the scene's ${holders.length} ${name} slot(s) are full (sceneLights({ ${name} }) or the lights.local-max quality knob)`,
        full,
      );
  };
  return {
    stats,
    /** Admit and release; then `point(world, i)` / `spot(world, i)` give each slot's light for this frame. */
    sync(world: World): void {
      stats.refused = empty();
      syncKind(world, 'point', point);
      syncKind(world, 'spot', spot);
      stats.admitted = {
        point: point.holders.filter(e => e !== null).length,
        spot: spot.holders.filter(e => e !== null).length,
      };
    },
    /** The light in slot `i` of `kind`, or null when the slot is dark (empty, or its light's data is invalid). */
    point(world: World, i: number): SlotLight<PointLightData> | null {
      return slotLight(world, kinds.point, i, checked);
    },
    spot(world: World, i: number): SlotLight<SpotLightData> | null {
      return slotLight(world, kinds.spot, i, checked);
    },
  };
}

function slotLight<D extends object>(
  world: World,
  kind: Kind<D>,
  i: number,
  checked: WeakMap<object, string>,
): SlotLight<D> | null {
  const entity = kind.holders[i];
  if (entity === null || entity === undefined) return null;
  const data = world.get(entity, kind.type);
  if (!data || !checked.has(data)) return null;
  return {entity, data};
}

export type LightSlots = ReturnType<typeof createLightSlots>;
