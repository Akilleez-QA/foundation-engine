/**
 * author/light-slots.ts: which entity's light holds which slot (VIS-02). Pure: no three.js, run by the scene runtime
 * once per frame and by `testScene` after each frame, so headless tests see the same admission and refusals.
 *
 * Rules (deterministic, never re-chosen per frame):
 *  - a light holds its slot until its entity loses the light component or its `Transform` (despawn included); the slot
 *    then drops to intensity 0 and is free;
 *  - lights waiting for a slot are admitted essential first, then in entity order (spawn order), into the lowest free
 *    slot; an admitted light is never moved to another slot or evicted;
 *  - a light with no free slot is refused (cause `full`) and admitted later if a slot frees; invalid data (a system
 *    wrote a value out of range) is refused (cause `invalid`) and its slot, if it had one, goes dark until fixed;
 *  - a scene without `sceneLights()` refuses every light (cause `no-slots`);
 *  - each cause is reported once per visit.
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
export type LightRefusal = 'full' | 'invalid' | 'no-slots';

export interface LightStats {
  /** Slots created for this visit (fixed). */
  readonly slots: Readonly<SceneLightLimits>;
  /** Lights holding a slot now. */
  admitted: {point: number; spot: number};
  /** Lights refused now, by cause. */
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
}

/** A slot's light for this frame: the entity and its data, or null for a dark slot. */
export interface SlotLight<D> {
  readonly entity: Entity;
  readonly data: D;
}

const LABEL: Record<LightKind, string> = {point: 'PointLight', spot: 'SpotLight'};

export function createLightSlots(o: {
  slots: SceneLightLimits;
  /** The scene asked for slots (`sceneLights()`); false refuses every light with `no-slots`. */
  enabled: boolean;
  report: (message: string) => void;
}) {
  const point: Kind<PointLightData> = {
      type: PointLight,
      validate: validatePointLight,
      key: d => `${pointLightKey(d)}|${d.essential}`,
      holders: Array.from({length: o.slots.point}, () => null),
    },
    spot: Kind<SpotLightData> = {
      type: SpotLight,
      validate: validateSpotLight,
      key: d => `${spotLightKey(d)}|${d.essential}`,
      holders: Array.from({length: o.slots.spot}, () => null),
    };
  const kinds = {point, spot};
  const stats: LightStats = {
    slots: Object.freeze({...o.slots}),
    admitted: {point: 0, spot: 0},
    refused: {full: 0, invalid: 0, 'no-slots': 0},
    reported: [],
  };
  // Validation is cached per data object and its signature: an unchanged light is not revalidated every frame.
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
  const refusal = (cause: LightRefusal, detail: string) => {
    stats.refused[cause]++;
    if (stats.reported.includes(cause)) return;
    stats.reported.push(cause);
    o.report(detail);
  };
  const transform = {id: 'transform'} as ComponentType<object>;
  const syncKind = <D extends object>(world: World, name: LightKind, kind: Kind<D>) => {
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
      if (!held.has(entity)) waiting.push({entity, data});
    }
    // Release slots whose entity left (despawned, or lost its light or Transform).
    for (const [entity, i] of held) if (!present.has(entity)) holders[i] = null;
    if (!o.enabled) {
      if (waiting.length)
        refusal(
          'no-slots',
          `a ${LABEL[name]} is not drawn: the scene has no light slots (defineScene({ lights: sceneLights() }))`,
        );
      return;
    }
    waiting.sort(
      (a, b) =>
        Number((b.data as {essential?: boolean}).essential) - Number((a.data as {essential?: boolean}).essential) ||
        a.entity - b.entity,
    );
    let refusedHere = 0;
    for (const w of waiting) {
      const free = holders.indexOf(null);
      if (free < 0) {
        refusedHere++;
        continue;
      }
      holders[free] = w.entity;
    }
    if (refusedHere)
      refusal(
        'full',
        `${refusedHere} ${LABEL[name]}(s) not drawn: the scene's ${holders.length} ${name} slot(s) are full (sceneLights({ ${name} }) or the lights.local-max quality knob)`,
      );
  };
  return {
    stats,
    /** Admit and release; then `slot(kind, i)` gives each slot's light for this frame. */
    sync(world: World): void {
      stats.refused = {full: 0, invalid: 0, 'no-slots': 0};
      syncKind(world, 'point', kinds.point);
      syncKind(world, 'spot', kinds.spot);
      stats.admitted = {
        point: kinds.point.holders.filter(e => e !== null).length,
        spot: kinds.spot.holders.filter(e => e !== null).length,
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
