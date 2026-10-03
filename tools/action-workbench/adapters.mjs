import {component} from '../../src/core/ecs/world.ts';
import {createMarkerTrack} from '../../src/kits/animation/markers.ts';
export const TargetState = component('action-target', {revision: 0, radius: 0.5, enabled: true});
const position = value => {
  if (!Array.isArray(value) || value.length !== 3) throw Error('position');
  const result = [value[0], value[1], value[2]];
  if (!result.every(Number.isFinite)) throw Error('position');
  return Object.freeze(result);
};
const identity = value => {
  if (typeof value !== 'string' || !value.length || value.length > 96) throw Error('identity');
  return value;
};
/** Scene-owned bindings to native objects. Neither authored labels nor entity numbers confer authority alone. */
export function createTargetAdapter({world, Transform}) {
  const bindings = new Map(),
    captures = new WeakMap();
  let retired = false,
    busy = false;
  const facts = binding => {
    if (retired || bindings.get(binding.id) !== binding || !world.exists(binding.entity)) return null;
    const transform = world.get(binding.entity, Transform),
      state = world.get(binding.entity, TargetState);
    if (!transform || !state) return null;
    // This sample accepts native own data fields only; accessor-backed facts are unsupported.
    // Capturing descriptors avoids executing a later getter that mutates an earlier scalar.
    const data = (object, key) => {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
    };
    const x = data(transform, 'x'),
      y = data(transform, 'y'),
      z = data(transform, 'z'),
      revision = data(state, 'revision'),
      radius = data(state, 'radius'),
      enabled = data(state, 'enabled');
    if (
      ![x, y, z, radius].every(Number.isFinite) ||
      radius < 0 ||
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      typeof enabled !== 'boolean'
    )
      return null;
    // Property access can execute creator code; reject a replacement/disposal during capture.
    if (
      retired ||
      bindings.get(binding.id) !== binding ||
      !world.exists(binding.entity) ||
      world.get(binding.entity, Transform) !== transform ||
      world.get(binding.entity, TargetState) !== state
    )
      return null;
    return {transform, state, position: [x, y, z], revision, radius, enabled};
  };
  return {
    bind(id, entity) {
      if (retired) return {status: 'retired'};
      if (busy) return {status: 'busy'};
      busy = true;
      try {
        identity(id);
        if (!Number.isSafeInteger(entity) || !world.exists(entity)) return {status: 'missing'};
        for (const [key, b] of bindings) if (!world.exists(b.entity)) bindings.delete(key);
        if (!bindings.has(id) && bindings.size >= 4) return {status: 'capacity'};
        const prior = bindings.get(id);
        const binding = {id, entity, token: Object.freeze({})};
        bindings.set(id, binding);
        if (!facts(binding)) {
          if (retired) return {status: 'retired'};
          if (prior) bindings.set(id, prior);
          else bindings.delete(id);
          return {status: 'invalid'};
        }
        return {status: 'bound'};
      } finally {
        busy = false;
      }
    },
    unbind(id) {
      if (retired) return false;
      if (busy) return false;
      return bindings.delete(id);
    },
    capture(id) {
      if (retired || busy) return null;
      busy = true;
      try {
        const binding = bindings.get(id);
        if (!binding) return null;
        const f = facts(binding);
        if (!f) return null;
        const result = Object.freeze({
          id,
          entity: binding.entity,
          token: binding.token,
          position: Object.freeze(f.position),
          revision: f.revision,
          radius: f.radius,
          enabled: f.enabled,
        });
        captures.set(result, {binding, ...f});
        return result;
      } finally {
        busy = false;
      }
    },
    same(captured) {
      if (retired || busy || !captured || typeof captured !== 'object') return false;
      const old = captures.get(captured);
      if (!old) return false;
      busy = true;
      try {
        const next = facts(old.binding);
        return (
          !!next &&
          next.transform === old.transform &&
          next.state === old.state &&
          next.revision === old.revision &&
          next.radius === old.radius &&
          next.enabled === old.enabled &&
          next.position.every((v, i) => v === old.position[i])
        );
      } finally {
        busy = false;
      }
    },
    dispose() {
      retired = true;
      bindings.clear();
    },
  };
}
const clip = Object.freeze({
  id: 'presentation-pulse',
  duration: 1,
  markers: Object.freeze([Object.freeze({id: 'open', at: 0.25}), Object.freeze({id: 'close', at: 0.75})]),
});
/** Native cue projection only. This owner never resolves actions or publishes consequences. */
export function createPresentationAdapter({world, Transform, Shape}) {
  const tracks = new Map();
  let retired = false;
  const hide = row => {
    if (row.entity !== null) {
      world.despawn(row.entity);
      row.entity = null;
    }
  };
  const read = action => {
    const row = tracks.get(action);
    return row
      ? Object.freeze({
          action,
          time: row.track.time,
          cancelled: row.cancelled,
          available: row.available,
          entity: row.entity,
          emitted: row.emitted,
          lastStatus: row.lastStatus,
        })
      : null;
  };
  const advanceRow = (row, time) => {
    if (retired) return {status: 'retired'};
    if (tracks.get(row.action) !== row || row.cancelled) return {status: 'stale'};
    if (row.busy) return {status: 'refused', reason: 'presentation busy', time: row.track.time};
    row.busy = true;
    try {
      let events;
      try {
        events = row.track.advance(time);
      } catch (error) {
        row.lastStatus = 'refused';
        return {status: 'refused', reason: error.message, time: row.track.time};
      }
      if (!row.available) {
        row.lastStatus = 'skipped';
        return {status: 'skipped', events, time: row.track.time};
      }
      if (events.length) {
        const last = events.at(-1),
          [x, y, z] = row.position;
        try {
          if (row.entity === null || !world.exists(row.entity))
            row.entity = world.spawn(
              Transform({x, y: y + 0.8, z, scale: 0.3}),
              Shape({kind: 'sphere', size: [1, 1, 1], color: 0x6bd7de}),
            );
          if (retired || row.cancelled || tracks.get(row.action) !== row) {
            hide(row);
            return {status: retired ? 'retired' : 'stale'};
          }
          if (!row.available) {
            hide(row);
            row.lastStatus = 'skipped';
            return {status: 'skipped', events, time: row.track.time};
          }
          const transform = world.get(row.entity, Transform);
          if (!transform) throw Error('cue transform missing');
          const nextY = y + 0.8 + (last.marker === 'open' ? 0.15 : 0);
          if (transform.y !== nextY) {
            transform.y = nextY;
            world.touch();
          }
          row.emitted += events.length;
          row.lastStatus = 'presented';
        } catch (error) {
          hide(row);
          row.lastStatus = 'skipped';
          return {status: 'skipped', reason: error.message, events, time: row.track.time};
        }
      } else row.lastStatus = 'idle';
      return {status: row.lastStatus, events, time: row.track.time};
    } finally {
      row.busy = false;
    }
  };
  return {
    begin(action, {position: location = [0, 0, 0], available = true} = {}) {
      if (retired) return {status: 'retired'};
      identity(action);
      if (typeof available !== 'boolean') throw Error('available');
      const captured = position(location);
      if (retired) return {status: 'retired'};
      if (tracks.has(action)) return {status: 'duplicate'};
      if (tracks.size >= 32) return {status: 'capacity'};
      tracks.set(action, {
        action,
        position: captured,
        available,
        entity: null,
        cancelled: false,
        busy: false,
        emitted: 0,
        lastStatus: 'idle',
        track: createMarkerTrack(clip, {action, loop: true, maxEvents: 16}),
      });
      return {status: 'started'};
    },
    advance(action, time) {
      const row = tracks.get(action);
      return row ? advanceRow(row, time) : {status: retired ? 'retired' : 'missing'};
    },
    captureAdvance(action) {
      const row = tracks.get(action);
      return time => (row ? advanceRow(row, time) : {status: retired ? 'retired' : 'missing'});
    },
    seek(action, time) {
      if (retired) return {status: 'retired'};
      const row = tracks.get(action);
      if (!row || row.cancelled) return {status: 'stale'};
      if (row.busy) return {status: 'refused', reason: 'presentation busy', time: row.track.time};
      try {
        row.track.seek(time);
        hide(row);
        row.lastStatus = 'seek';
        return {status: 'seek', time: row.track.time};
      } catch (error) {
        return {status: 'refused', reason: error.message, time: row.track.time};
      }
    },
    setAvailable(action, available) {
      if (retired) return {status: 'retired'};
      if (typeof available !== 'boolean') throw Error('available');
      const row = tracks.get(action);
      if (!row || row.cancelled) return {status: 'stale'};
      row.available = available;
      if (!available) hide(row);
      return {status: available ? 'available' : 'unavailable'};
    },
    cancel(action) {
      if (retired) return false;
      const row = tracks.get(action);
      if (!row || row.cancelled) return false;
      row.cancelled = true;
      row.track.cancel();
      hide(row);
      row.lastStatus = 'cancelled';
      return true;
    },
    read,
    dispose() {
      if (retired) return;
      retired = true;
      for (const row of tracks.values()) {
        row.cancelled = true;
        row.track.cancel();
        hide(row);
      }
      tracks.clear();
    },
  };
}
