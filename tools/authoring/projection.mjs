import {Name, Transform, Shape} from '../../src/author/index.ts';
import {validDocument} from './document.mjs';

// Authored IDs are map keys only; local ECS IDs never enter document storage.
export function createProjection(world, {reverse = false} = {}) {
  const identities = new Map();
  let ghost = null, failNext = false;
  const inits = (o, preview = false) => [Name({name: preview ? 'preview' : o.id}), Transform({x:o.x, y:o.y, z:o.z, ry:o.ry}),
    Shape({kind: 'box', size: preview ? [1.9, .08, .95] : [1.5, .6, .65], color: preview ? 0xffc66d : o.id === 'A' ? 0x75d8d0 : 0x8eaaff})];
  const clearGhost = () => { if (ghost !== null) world.despawn(ghost); ghost = null; };
  const apply = value => {
    if (!validDocument(value)) throw Error('Projection rejected invalid objects');
    // Stage every initializer before touching any live object. Deliberate failure
    // is after staging, before application; arbitrary callback rollback is not promised.
    const ordered = reverse ? [...value.objects].reverse() : value.objects;
    const staged = ordered.map(o => ({o, components: inits(o)}));
    if (failNext) { failNext = false; throw Error('Injected staging failure'); }
    for (const {o, components} of staged) {
      const old = identities.get(o.id);
      if (old !== undefined && world.exists(old)) Object.assign(world.get(old, Transform), components[1].value);
      else identities.set(o.id, world.spawn(...components));
    }
    for (const [id, runtime] of identities) if (!value.objects.some(o => o.id === id)) { world.despawn(runtime); identities.delete(id); }
    world.touch();
  };
  return {apply, clearGhost,
    ghost(o) { clearGhost(); ghost = world.spawn(...inits(o, true)); },
    failNext() { failNext = true; },
    inspect() { return {objects: [...identities].map(([id, runtime]) => ({id, runtime, ...world.get(runtime, Transform)})),
      ghost: ghost === null ? null : {runtime: ghost, ...world.get(ghost, Transform)}, count: world.count}; },
    dispose() { clearGhost(); for (const runtime of identities.values()) world.despawn(runtime); identities.clear(); },
  };
}
