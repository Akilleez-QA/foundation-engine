import {Quaternion, Vector3} from 'three';
import type {JointPose} from './pose-clip';
export interface PoseLayer {
  readonly pose: readonly JointPose[];
  readonly mask: readonly string[];
  readonly weight: number;
}
/** Ordered override layers: masked joints only, without any root-motion or marker authority. */
export function blendPoseLayers(base: readonly JointPose[], layers: readonly PoseLayer[]): JointPose[] {
  if (base.length > 128 || layers.length > 8 || new Set(base.map(p => p.joint)).size !== base.length)
    throw Error('pose layers: budget or duplicate joint');
  const valid = (p: JointPose) => {
    if (
      !p.joint ||
      p.position.length !== 3 ||
      p.rotation.length !== 4 ||
      ![...p.position, ...p.rotation].every(v => Number.isFinite(v) && Math.abs(v) <= 1e6) ||
      Math.hypot(...p.rotation) < 1e-12
    )
      throw Error('pose layers: invalid pose');
  };
  const result = new Map<string, JointPose>();
  for (const p of base) {
    valid(p);
    result.set(p.joint, {
      joint: p.joint,
      position: [...p.position],
      rotation: new Quaternion(...p.rotation).normalize().toArray(),
    });
  }
  for (const layer of layers) {
    if (
      !Number.isFinite(layer.weight) ||
      layer.weight < 0 ||
      layer.weight > 1 ||
      layer.pose.length > 128 ||
      layer.mask.length > 128 ||
      new Set(layer.pose.map(p => p.joint)).size !== layer.pose.length
    )
      throw Error('pose layers: invalid layer');
    const mask = new Set(layer.mask);
    for (const id of mask) if (!result.has(id)) throw Error('pose layers: unknown masked joint');
    for (const p of layer.pose) {
      valid(p);
      if (!mask.has(p.joint)) continue;
      const from = result.get(p.joint)!;
      result.set(p.joint, {
        joint: p.joint,
        position: from.position.map(
          (v, i) => v + (p.position[i]! - v) * layer.weight /* i < 3: positions are validated triples */,
        ) as [number, number, number],
        rotation: new Quaternion(...from.rotation)
          .slerp(new Quaternion(...p.rotation).normalize(), layer.weight)
          .toArray(),
      });
    }
  }
  return [...result.values()];
}
/** Two links with rest axes +Y, returned as local shoulder/elbow rotations plus world elbow/tip. */
export function solveTwoBone(
  root: readonly number[],
  target: readonly number[],
  pole: readonly number[],
  upper: number,
  lower: number,
) {
  if (
    [root, target, pole].some(v => v.length !== 3 || !v.every(n => Number.isFinite(n) && Math.abs(n) <= 1e6)) ||
    ![upper, lower].every(v => Number.isFinite(v) && v > 1e-6 && v <= 1e6)
  )
    throw Error('IK: invalid input');
  const start = new Vector3(...root),
    toward = new Vector3(...target).sub(start),
    distance = toward.length();
  if (!Number.isFinite(distance)) throw Error('IK: invalid distance');
  if (distance < 1e-9) toward.set(0, 1, 0);
  else toward.divideScalar(distance);
  const poleVector = new Vector3(...pole).sub(start);
  poleVector.addScaledVector(toward, -poleVector.dot(toward));
  if (poleVector.lengthSq() < 1e-12) {
    poleVector.set(Math.abs(toward.x) < 0.9 ? 1 : 0, 0, Math.abs(toward.x) < 0.9 ? 0 : 1);
    poleVector.addScaledVector(toward, -poleVector.dot(toward));
  }
  poleVector.normalize();
  const reach = Math.min(upper + lower - 1e-7, Math.max(Math.abs(upper - lower) + 1e-7, distance));
  const along = (upper * upper - lower * lower + reach * reach) / (2 * reach),
    height = Math.sqrt(Math.max(0, upper * upper - along * along));
  const elbow = start.clone().addScaledVector(toward, along).addScaledVector(poleVector, height),
    tip = start.clone().addScaledVector(toward, reach);
  const shoulderRotation = new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    elbow.clone().sub(start).normalize(),
  );
  const lowerWorld = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), tip.clone().sub(elbow).normalize());
  const elbowRotation = shoulderRotation.clone().invert().multiply(lowerWorld);
  return {
    elbow: elbow.toArray(),
    tip: tip.toArray(),
    shoulderRotation: shoulderRotation.toArray(),
    elbowRotation: elbowRotation.toArray(),
    reachable: distance >= Math.abs(upper - lower) && distance <= upper + lower,
  };
}
