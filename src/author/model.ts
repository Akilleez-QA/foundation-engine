import {defineComponent} from './defs';
export interface ModelJointPose {
  node: string;
  position?: readonly [number, number, number];
  rotation?: readonly [number, number, number, number];
}
export interface ModelData {
  asset: string;
  visible: boolean;
  /** Clip name, empty means bind pose. */
  clip: string;
  playing: boolean;
  loop: boolean;
  speed: number;
  /** Increment to restart playback, including replaying the same clip. */
  revision: number;
  /**
   * Seconds to blend from the displayed pose into a newly selected clip, restart or bind pose; 0 (default) cuts.
   * At most `MAX_MODEL_TRANSITION`. Presentation only: it never changes timing, markers or the actor transform.
   */
  transition?: number;
  /** Explicit local pose overrides applied after the skeletal clip. */
  pose: readonly ModelJointPose[];
}
export const Model = defineComponent<ModelData>('model', {
  asset: '',
  visible: true,
  clip: '',
  playing: true,
  loop: true,
  speed: 1,
  revision: 0,
  transition: 0,
  pose: [],
});
/** Longest accepted `Model.transition`, in seconds. */
export const MAX_MODEL_TRANSITION = 2;
export interface ModelSocketPose {
  readonly name: string;
  readonly matrix: readonly number[];
}
export function validateModel(data: ModelData): void {
  if (
    typeof data.asset !== 'string' ||
    !data.asset ||
    data.asset.length > 256 ||
    typeof data.clip !== 'string' ||
    data.clip.length > 256 ||
    ![data.visible, data.playing, data.loop].every(v => typeof v === 'boolean') ||
    !Number.isFinite(data.speed) ||
    data.speed < 0 ||
    data.speed > 16 ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0 ||
    (data.transition !== undefined &&
      (!Number.isFinite(data.transition) || data.transition < 0 || data.transition > MAX_MODEL_TRANSITION))
  )
    throw Error('model: invalid definition');
  if (
    !Array.isArray(data.pose) ||
    data.pose.length > 128 ||
    new Set(data.pose.map(p => p.node)).size !== data.pose.length
  )
    throw Error('model: invalid joint pose');
  for (const p of data.pose) {
    if (typeof p.node !== 'string' || !p.node || p.node.length > 256 || (!p.position && !p.rotation))
      throw Error('model: invalid pose node');
    if (
      p.position &&
      (p.position.length !== 3 || !p.position.every((v: number) => Number.isFinite(v) && Math.abs(v) <= 1e6))
    )
      throw Error('model: invalid pose position');
    if (
      p.rotation &&
      (p.rotation.length !== 4 ||
        !p.rotation.every((v: number) => Number.isFinite(v) && Math.abs(v) <= 1e6) ||
        Math.hypot(...p.rotation) < 1e-12)
    )
      throw Error('model: invalid pose rotation');
  }
}
