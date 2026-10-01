import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { defineComponent, defineKit, defineSystem, Transform, type Entity, type SceneContext, type KitDefinition, type SystemDefinition } from '../../author';
import { createSocketRig, type SocketLod } from '../animation';
import { authorPose, frameRef, poseMatrix, type FrameRef, type Frames } from '../frames';
export const VehicleRider = defineComponent('vehicles-rider', { id: '' });
interface Vehicle { frame: FrameRef; lod: string; rig: ReturnType<typeof createSocketRig>; occupied: Map<string, string> }
/** Local seating authority. Stable seat socket IDs and rider IDs, one vehicle owner per rider. */
export function createVehicles(frames: Frames, maxVehicles = 16, maxRiders = 64) {
  if (![maxVehicles, maxRiders].every(n => Number.isSafeInteger(n) && n > 0)) throw Error('invalid vehicle budget');
  const vehicles = new Map<string, Vehicle>(), riders = new Map<string, { vehicle: string; seat: string }>();
  const sample = (rider: string): readonly number[] | null => {
    const owner = riders.get(rider); if (!owner) return null;
    const v = vehicles.get(owner.vehicle)!; const parent = frames.resolve(v.frame); if (!parent) return null;
    return v.rig.sample(rider, v.lod, { id: v.frame.id, matrix: parent }).matrix;
  };
  return {
    register(id: string, frame: FrameRef, lods: readonly SocketLod[], lod: string) {
      if (!id || vehicles.has(id) || vehicles.size >= maxVehicles || !lods.some(l => l.id === lod)) throw Error('invalid vehicle registration');
      vehicles.set(id, { frame: frameRef(frame), lod, rig: createSocketRig(lods, maxRiders), occupied: new Map() });
    },
    board(rider: string, vehicle: string, seat: string, worldPose: readonly number[]): boolean {
      const v = vehicles.get(vehicle);
      if (!v || !rider || riders.has(rider) || riders.size >= maxRiders || v.occupied.has(seat)) return false;
      const parent = frames.resolve(v.frame); if (!parent) return false;
      const world = poseMatrix(worldPose);
      // Temporary sample determines socket pose. No public ownership changes until every calculation succeeds.
      v.rig.attach(rider, seat);
      let local: readonly number[];
      try {
        const socket = v.rig.sample(rider, v.lod, { id: v.frame.id, matrix: parent }).matrix;
        local = poseMatrix(new Matrix4().fromArray(socket).invert().multiply(new Matrix4().fromArray(world)).elements);
      } finally { v.rig.detach(rider); }
      v.rig.attach(rider, seat, local); v.occupied.set(seat, rider); riders.set(rider, { vehicle, seat }); return true;
    },
    pose: sample,
    hasRider(rider: string) { return riders.has(rider); },
    /** Validate requested exit world pose before detaching. Null pose preserves current world pose. */
    exit(rider: string, requested: readonly number[] | null, canPlace: (pose: readonly number[]) => boolean): readonly number[] | null {
      const owner = riders.get(rider); if (!owner) return null;
      const value = requested === null ? sample(rider) : poseMatrix(requested); if (!value || !canPlace(value)) return null;
      // A callback may re-enter; never remove a replacement owner.
      if (riders.get(rider) !== owner) return null;
      const v = vehicles.get(owner.vehicle)!; v.rig.detach(rider); v.occupied.delete(owner.seat); riders.delete(rider); return value;
    },
    unregister(id: string): boolean { const v = vehicles.get(id); if (!v || v.occupied.size) return false; return vehicles.delete(id); },
    get size() { return riders.size; },
  };
}
export type Vehicles = ReturnType<typeof createVehicles>;
/** Run after vehicle movement; use hasRider to disable independent character motion while seated. */
export function vehicleRiderSystem(vehicles: Vehicles): SystemDefinition {
  return defineSystem({ id: 'vehicles-follow', run(ctx) {
    for (const [, rider, tr] of ctx.world.query(VehicleRider, Transform)) {
      const value = vehicles.pose(rider.id); if (!value) continue;
      const pose = authorPose(value);
      if ((Object.keys(pose) as (keyof typeof pose)[]).some(key => tr[key] !== pose[key])) { Object.assign(tr, pose); ctx.world.touch(); }
    }
  } });
}
export function vehicles(): KitDefinition { return defineKit({ id: 'vehicles', requires: ['frames', 'animation'], defs: [], modules: [] }); }

/** Board from the current author pose; caller must gate independent movement with hasRider(). */
export function boardVehicle(ctx: SceneContext, entity: Entity, fleet: Vehicles, vehicle: string, seat: string): boolean {
  const rider = ctx.world.get(entity, VehicleRider), tr = ctx.world.get(entity, Transform);
  if (!rider || !tr) return false;
  const matrix = new Matrix4().compose(new Vector3(tr.x, tr.y, tr.z), new Quaternion().setFromEuler(new Euler(tr.rx, tr.ry, tr.rz)), new Vector3(tr.scale, tr.scale, tr.scale));
  return fleet.board(rider.id, vehicle, seat, matrix.elements);
}
/** Exit checks representation and placement before seat ownership or author Transform changes. */
export function exitVehicle(ctx: SceneContext, entity: Entity, fleet: Vehicles, requested: readonly number[] | null, canPlace: (pose: readonly number[]) => boolean): boolean {
  const rider = ctx.world.get(entity, VehicleRider), tr = ctx.world.get(entity, Transform);
  if (!rider || !tr) return false;
  const target = requested ?? fleet.pose(rider.id); if (!target) return false;
  const pose = authorPose(target);
  if (!fleet.exit(rider.id, target, canPlace)) return false;
  Object.assign(tr, pose); ctx.world.touch(); return true;
}
