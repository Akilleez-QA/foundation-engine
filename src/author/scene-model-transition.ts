import * as T from 'three';
/** Most distinct nodes a model's clips may animate for a transition; larger rigs cut and report instead. */
export const MAX_TRANSITION_NODES = 512;
/**
 * Presentation blend from a captured pose into whatever the mixer now evaluates.
 *
 * The owner (scene-model) calls, per sync and in this order: `restore()` before the mixer is evaluated, then
 * `blend(dt)` after it. `restore()` puts every animated node back to the base recorded when the transition began, so
 * nodes the new clip does not drive return to their original values and are never blended twice. `blend` writes
 * mix(from, evaluated, smoothstep(elapsed / duration)) into position, quaternion and scale and reports completion.
 * Other animated properties (morph weights, materials) are not captured: they change at once, as before.
 */
export interface ClipTransition {
  restore(): void;
  /** Advances by `dt` seconds, writes the blended pose and returns true while it is still blending. */
  blend(dt: number): boolean;
}
interface NodePose {
  position: T.Vector3;
  quaternion: T.Quaternion;
  scale: T.Vector3;
}
const capture = (nodes: readonly T.Object3D[], into: NodePose[]) => {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!,
      p = (into[i] ??= {position: new T.Vector3(), quaternion: new T.Quaternion(), scale: new T.Vector3()});
    p.position.copy(n.position);
    p.quaternion.copy(n.quaternion);
    p.scale.copy(n.scale);
  }
};
/** The distinct nodes of `root` that any of `clips` animates, in first-track order, or null over the budget. */
export function animatedNodes(root: T.Object3D, clips: readonly T.AnimationClip[]): T.Object3D[] | null {
  const nodes = new Set<T.Object3D>();
  for (const clip of clips)
    for (const track of clip.tracks) {
      const {nodeName, propertyName} = T.PropertyBinding.parseTrackName(track.name);
      if (propertyName !== 'position' && propertyName !== 'quaternion' && propertyName !== 'scale') continue;
      const node = T.PropertyBinding.findNode(root, nodeName) as T.Object3D | null | undefined;
      if (!node || !(node instanceof T.Object3D)) continue;
      nodes.add(node);
      if (nodes.size > MAX_TRANSITION_NODES) return null;
    }
  return [...nodes];
}
/**
 * Begin a transition. `from` was captured with `captureFrom` before the mixer switched; the nodes now hold the new
 * clip's first evaluation, which becomes the base. Buffers are reused across transitions of one model instance.
 */
export function createClipTransitions(nodes: readonly T.Object3D[]) {
  const buffers: [NodePose[], NodePose[]] = [[], []];
  const base: NodePose[] = [];
  let next = 0;
  return {
    /** Snapshot the displayed pose (without pose overrides) into a free buffer. */
    captureFrom(): NodePose[] {
      const into = buffers[next]!;
      next = 1 - next;
      capture(nodes, into);
      return into;
    },
    start(from: NodePose[], duration: number): ClipTransition {
      if (!Number.isFinite(duration) || duration <= 0) throw Error('model: invalid transition duration');
      capture(nodes, base);
      let elapsed = 0;
      const evaluated = new T.Quaternion();
      return {
        restore() {
          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i]!,
              b = base[i]!;
            n.position.copy(b.position);
            n.quaternion.copy(b.quaternion);
            n.scale.copy(b.scale);
          }
        },
        blend(dt) {
          if (!Number.isFinite(dt) || dt < 0) throw Error('model: invalid playback delta');
          elapsed = Math.min(duration, elapsed + dt);
          if (elapsed >= duration) return false;
          const t = elapsed / duration,
            k = t * t * (3 - 2 * t);
          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i]!,
              f = from[i]!;
            n.position.lerpVectors(f.position, n.position, k);
            // Keep the evaluated rotation aside before the node is overwritten with the captured one.
            evaluated.copy(n.quaternion);
            n.quaternion.copy(f.quaternion).slerp(evaluated, k);
            n.scale.lerpVectors(f.scale, n.scale, k);
          }
          return true;
        },
      };
    },
  };
}
export type ClipTransitions = ReturnType<typeof createClipTransitions>;
