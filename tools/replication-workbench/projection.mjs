import {defineComponent, Name, Transform, Shape} from '../../src/author/defs.ts';

export const Replica = defineComponent('replica-facts', {
  id: '',
  incarnation: 0,
  fields: {},
});

/** Reference policy only: complete logical fields replace old fields, never merge them. */
export function createReplicaProjection(world, {maxEntities = 64, beforeWrite = () => {}} = {}) {
  if (!Number.isSafeInteger(maxEntities) || maxEntities < 1) throw Error('projection limit');
  const slots = new Map();
  let retired = false,
    busy = false,
    generation = {};
  const clear = () => {
    generation = {};
    const old = [...slots.values()];
    slots.clear();
    for (const slot of old) world.despawn(slot.entity);
  };
  function preflight(view) {
    if (!Array.isArray(view?.entities) || view.entities.length > maxEntities) throw Error('entities');
    const seen = new Set();
    return view.entities.map((row, index) => {
      if (
        !row ||
        typeof row.id !== 'string' ||
        !row.id ||
        row.id.length > 256 ||
        seen.has(row.id) ||
        !Number.isSafeInteger(row.incarnation) ||
        row.incarnation < 0
      )
        throw Error('identity');
      seen.add(row.id);
      const fields = row.fields;
      if (
        !fields ||
        typeof fields !== 'object' ||
        Array.isArray(fields) ||
        Object.keys(fields).some(key => !['value', 'private'].includes(key))
      )
        throw Error('fields');
      if (
        Object.hasOwn(fields, 'value') &&
        (!Number.isSafeInteger(fields.value) || fields.value < 0 || fields.value > 100000)
      )
        throw Error('value');
      if (Object.hasOwn(fields, 'private') && (typeof fields.private !== 'string' || fields.private.length > 128))
        throw Error('private');
      const captured = Object.freeze({...fields});
      const height = 0.4 + Math.min(fields.value ?? 0, 20) * 0.04;
      return {
        id: row.id,
        incarnation: row.incarnation,
        inits: [
          Name({name: `replica:${row.id}`}),
          Replica({
            id: row.id,
            incarnation: row.incarnation,
            fields: captured,
          }),
          Transform({
            x: 1 + (index % 8) * 0.75,
            z: Math.floor(index / 8) * 0.75,
            y: height / 2,
          }),
          Shape({
            kind: 'box',
            size: [0.55, height, 0.55],
            color: Object.hasOwn(fields, 'private') ? 0x75cabb : 0xe7bd67,
          }),
        ],
      };
    });
  }
  return Object.freeze({
    replace(view) {
      if (retired) return {status: 'retired'};
      if (busy) return {status: 'busy'};
      busy = true;
      try {
        const attempt = generation;
        const rows = preflight(view),
          wanted = new Set(rows.map(row => row.id));
        if (generation !== attempt) return {status: retired ? 'retired' : 'failed'};
        for (const [id, slot] of slots)
          if (!wanted.has(id)) {
            slots.delete(id);
            world.despawn(slot.entity);
          }
        for (let index = 0; index < rows.length; index++) {
          const row = rows[index];
          beforeWrite(row.id, index);
          if (retired || generation !== attempt) return {status: retired ? 'retired' : 'failed'};
          let slot = slots.get(row.id);
          if (slot && slot.incarnation !== row.incarnation) {
            slots.delete(row.id);
            world.despawn(slot.entity);
            slot = null;
          }
          if (slot) for (const init of row.inits) world.add(slot.entity, init);
          else {
            const entity = world.spawn(...row.inits);
            slots.set(row.id, {entity, incarnation: row.incarnation});
          }
        }
        return {status: 'projected'};
      } catch {
        clear();
        return {status: retired ? 'retired' : 'failed'};
      } finally {
        busy = false;
      }
    },
    clear,
    // One consumer-held callback can stand in for delayed optional presentation work.
    // It holds no field payload and cannot act on a replacement/local reappearance.
    prepareDecoration(id) {
      const slot = slots.get(id);
      let used = false;
      return () => {
        if (used || retired || !slot || slots.get(id) !== slot || !world.exists(slot.entity)) return false;
        used = true;
        const shape = world.get(slot.entity, Shape);
        if (!shape) return false;
        shape.color = 0xd987df;
        world.touch();
        return true;
      };
    },
    dispose() {
      if (retired) return;
      retired = true;
      clear();
    },
  });
}
