import {Name, Transform, Shape} from '../../src/author/index.ts';
import {compatible} from './schema.mjs';

// Borrows the existing ECS and Shape renderer. No assets, clock or storage owner.
export function createProjection(world) {
  let accepted = null,
    preview = null,
    failNext = false,
    retired = false;
  const spawn = (value, x, name) => {
    if (retired || !compatible(value)) throw Error('Appearance projection rejected');
    const {scale, tint} = value.parameters;
    const components = [
      Name({name}),
      Transform({x, y: 0, z: 0}),
      Shape({kind: value.parts.form, size: [scale, scale, scale], color: tint}),
    ];
    if (failNext) {
      failNext = false;
      throw Error('Injected projection preparation failure');
    }
    return world.spawn(...components);
  };
  const removePreview = () => {
    if (preview !== null) world.despawn(preview);
    preview = null;
  };
  return {
    apply(value) {
      const next = spawn(value, -1.5, 'accepted');
      if (accepted !== null) world.despawn(accepted);
      accepted = next;
      removePreview();
      world.touch();
    },
    preview(value) {
      removePreview();
      preview = spawn(value, 1.5, 'preview');
      world.touch();
    },
    clearPreview: removePreview,
    failNext() {
      failNext = true;
    },
    inspect() {
      const read = entity =>
        entity === null
          ? null
          : {entity, transform: {...world.get(entity, Transform)}, shape: structuredClone(world.get(entity, Shape))};
      return {accepted: read(accepted), preview: read(preview), count: world.count};
    },
    dispose() {
      if (retired) return;
      retired = true;
      removePreview();
      if (accepted !== null) world.despawn(accepted);
      accepted = null;
    },
  };
}
