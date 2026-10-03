import {Matrix4} from 'three';
import {frameRef, poseMatrix, type FrameRef, type Frames} from './frame';
export interface FrameUpdate {
  readonly generation: number;
  readonly sequence: number;
  readonly frame: FrameRef;
  readonly local: readonly number[];
}
interface RecordState {
  alive: boolean;
  generation: number;
  newestSeen: number;
  applied: number;
  pending: FrameUpdate | null;
  world: readonly number[] | null;
  frame: FrameRef | null;
  local: readonly number[] | null;
  revision: number;
}
/** Bounded locally received pose updates. Register lifetimes explicitly; packets cannot create ownership. */
export function createFrameUpdates(frames: Frames, maxOwners = 128) {
  if (!Number.isSafeInteger(maxOwners) || maxOwners < 1) throw Error('invalid update budget');
  const owners = new Map<string, RecordState>();
  return {
    register(id: string, generation: number) {
      frameRef({id, generation});
      const old = owners.get(id);
      if (old && generation <= old.generation) throw Error('owner generation must advance');
      if (!old && owners.size >= maxOwners) throw Error('update owner budget exceeded');
      owners.set(id, {
        alive: true,
        generation,
        newestSeen: -1,
        applied: -1,
        pending: null,
        world: null,
        frame: null,
        local: null,
        revision: 0,
      });
    },
    cancel(id: string, generation: number): boolean {
      const o = owners.get(id);
      if (!o?.alive || o.generation !== generation) return false;
      o.alive = false;
      o.pending = null;
      o.world = null;
      o.frame = null;
      o.local = null;
      return true;
    },
    offer(id: string, update: FrameUpdate): boolean {
      const o = owners.get(id);
      if (!Number.isSafeInteger(update.sequence) || update.sequence < 0) throw Error('invalid update sequence');
      if (!o?.alive || o.generation !== update.generation || update.sequence <= o.newestSeen) return false;
      const value = Object.freeze({...update, frame: frameRef(update.frame), local: poseMatrix(update.local)});
      o.newestSeen = value.sequence;
      o.pending = value;
      return true;
    },
    /** Work is bounded by owner records examined, including unresolved dependencies. */
    pump(limit: number): number {
      if (!Number.isSafeInteger(limit) || limit < 1) throw Error('invalid update work limit');
      let applied = 0;
      // Rotate examined owners for fairness when missing parents occupy early slots.
      const count = Math.min(limit, owners.size);
      for (let i = 0; i < count; i++) {
        const [id, o] = owners.entries().next().value!;
        owners.delete(id);
        owners.set(id, o);
        if (!o.alive) continue;
        if (o.pending && frames.resolve(o.pending.frame)) {
          o.frame = o.pending.frame;
          o.local = o.pending.local;
          o.applied = o.pending.sequence;
          o.pending = null;
          o.revision++;
          applied++;
        }
        if (!o.frame || !o.local) continue;
        const parent = frames.resolve(o.frame);
        const world = parent
          ? poseMatrix(new Matrix4().fromArray(parent).multiply(new Matrix4().fromArray(o.local)).elements)
          : null;
        if (
          (world === null) !== (o.world === null) ||
          (world && o.world && world.some((v, index) => v !== o.world![index]))
        ) {
          o.world = world;
          o.revision++;
        }
      }
      return applied;
    },
    state(id: string) {
      const o = owners.get(id);
      return o?.alive
        ? Object.freeze({
            generation: o.generation,
            newestSeen: o.newestSeen,
            applied: o.applied,
            pending: o.pending !== null,
            world: o.world,
            frame: o.frame,
            local: o.local,
            revision: o.revision,
          })
        : null;
    },
    get size() {
      return owners.size;
    },
  };
}
export type FrameUpdates = ReturnType<typeof createFrameUpdates>;
