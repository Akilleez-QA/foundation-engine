export interface ClipMarker {
  readonly id: string;
  readonly at: number;
}
export interface MarkerClip {
  readonly id: string;
  readonly duration: number;
  readonly markers: readonly ClipMarker[];
}
export interface MarkerOccurrence {
  readonly action: string;
  readonly marker: string;
  readonly cycle: number;
  readonly at: number;
  readonly key: string;
}
/** Definitions are snapshotted so a caller cannot change timing during playback. */
export function defineMarkerClip(input: MarkerClip): MarkerClip {
  if (!input.id || !Number.isFinite(input.duration) || input.duration <= 0)
    throw Error('clip needs id and positive duration');
  const ids = new Set<string>();
  const markers = input.markers
    .map(marker => {
      if (
        !marker.id ||
        ids.has(marker.id) ||
        !Number.isFinite(marker.at) ||
        marker.at < 0 ||
        marker.at >= input.duration
      )
        throw Error('invalid or duplicate clip marker');
      ids.add(marker.id);
      return Object.freeze({...marker});
    })
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  return Object.freeze({id: input.id, duration: input.duration, markers: Object.freeze(markers)});
}
/** Presentation events, never authority for inventory/rewards. Caller supplies a unique action-instance ID. */
export function createMarkerTrack(input: MarkerClip, options: {action: string; loop?: boolean; maxEvents?: number}) {
  const clip = defineMarkerClip(input),
    maxEvents = options.maxEvents ?? 64;
  const action = options.action,
    loop = options.loop ?? false;
  if (!action || !Number.isSafeInteger(maxEvents) || maxEvents < 1) throw Error('invalid marker track options');
  let cursor = 0,
    canceled = false;
  const position = (time: number) => {
    if (!Number.isFinite(time) || time < 0 || !Number.isSafeInteger(Math.floor(time / clip.duration)))
      throw Error('invalid animation time');
    return loop ? time : Math.min(time, clip.duration);
  };
  return {
    clip,
    get time() {
      return cursor;
    },
    /** Seek/teleport changes presentation time without generating crossed action markers. */
    seek(time: number) {
      cursor = position(time);
    },
    cancel() {
      canceled = true;
    },
    advance(time: number): readonly MarkerOccurrence[] {
      const next = position(time);
      if (next < cursor) throw Error('use seek for backwards animation time');
      if (canceled) return [];
      const events: MarkerOccurrence[] = [];
      for (const marker of clip.markers) {
        const first = loop ? Math.max(0, Math.floor((cursor - marker.at) / clip.duration) + 1) : 0;
        const last = loop ? Math.floor((next - marker.at) / clip.duration) : 0;
        // Check count before allocating or mutating the cursor, even after a huge time jump.
        if (last >= first && marker.at + first * clip.duration > cursor && marker.at + first * clip.duration <= next) {
          const count = last - first + 1;
          if (events.length + count > maxEvents)
            throw Error('animation marker budget exceeded; seek or advance in smaller steps');
          for (let cycle = first; cycle <= last; cycle++) {
            const at = marker.at + cycle * clip.duration;
            events.push(
              Object.freeze({action, marker: marker.id, cycle, at, key: JSON.stringify([action, cycle, marker.id])}),
            );
          }
        }
      }
      events.sort((a, b) => a.at - b.at || a.marker.localeCompare(b.marker));
      cursor = next;
      return Object.freeze(events);
    },
  };
}
