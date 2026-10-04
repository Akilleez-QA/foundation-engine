// Clip events from the pose-to-pose manifest drive @kits/animation markers on the clip's own clock,
// so effects and sounds fire from the animation's time, not from separate timers.
import {
  createMarkerTrack,
  defineMarkerClip,
  createRootMotion,
  type MarkerOccurrence,
  type RootClip,
} from '@kits/animation';

export interface ManifestClip {
  readonly name: string;
  readonly playback: 'loop' | 'once' | 'hold';
  readonly duration: number;
  readonly events: readonly {readonly name: string; readonly at: number}[];
  readonly rootMotion?: {readonly clip: RootClip};
}
export interface Manifest {
  readonly clips: readonly ManifestClip[];
}

export function manifestClip(manifest: Manifest, name: string): ManifestClip {
  const clip = manifest.clips.find(c => c.name === name);
  if (!clip) throw Error(`clip ${name} is not in the manifest`);
  return clip;
}

/** A marker track for one playing of a clip; `action` must be unique per playing. */
export function clipEvents(clip: ManifestClip, action: string) {
  const markers = defineMarkerClip({
    id: clip.name,
    duration: clip.duration,
    markers: clip.events.map(e => ({id: e.name, at: e.at})),
  });
  return createMarkerTrack(markers, {action, loop: clip.playback === 'loop'});
}

/** The clip's declared travel as an @kits/animation root-motion sampler. */
export function clipRootMotion(clip: ManifestClip) {
  if (!clip.rootMotion) throw Error(`clip ${clip.name} declares no root motion`);
  return createRootMotion(clip.rootMotion.clip, clip.playback === 'loop');
}

export type {MarkerOccurrence};
