/** author/body.ts: spawning a scene's entities into a world. Shared by the browser runtime and `testScene` (no three.js). */
import type {World, ComponentInit, Entity} from '../core/ecs/world';
import type {EntityDefinition, SceneBody, SceneDefinition} from './defs';

/** Spawn a prefab or a list of initialisers; each spawn gets fresh copies of the component values. */
export function spawnInto(
  world: World,
  entry: EntityDefinition | readonly ComponentInit<object>[],
  extra: readonly ComponentInit<object>[] = [],
): Entity {
  const inits = 'kind' in entry ? entry.components : entry;
  return world.spawn(...[...inits, ...extra].map(i => ({type: i.type, value: structuredClone(i.value)})));
}

/** The scene's body: its inline entities and systems, plus the lazily imported ones. */
export async function bodyOf(scene: SceneDefinition): Promise<Required<SceneBody>> {
  const loaded = scene.body ? await scene.body() : {};
  const extra = ('default' in loaded ? loaded.default : loaded) as SceneBody;
  return {
    entities: [...(scene.entities ?? []), ...(extra.entities ?? [])],
    systems: [...(scene.systems ?? []), ...(extra.systems ?? [])],
  };
}
