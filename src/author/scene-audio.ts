import type {CueVoice, CueVoiceOptions} from '../platform/audio/audio-output';
type Owned = {readonly ended: boolean; stop(): void};
/** Close admission before callbacks run; one failing handle cannot strand its siblings. Generic over cue voices and
 *  music voices (anything with `ended`, `stop()` and an `onEnded` option). */
export function createSceneVoices<V extends Owned = CueVoice, O extends {onEnded?: () => void} = CueVoiceOptions>(
  play: (cue: string, options: O) => V | null,
) {
  const voices = new Set<V>();
  let closed = false;
  return {
    play(cue: string, options: O = {} as O): V | null {
      if (closed) return null;
      let voice: V | null = null;
      voice = play(cue, {
        ...options,
        onEnded: () => {
          if (voice) voices.delete(voice);
          options.onEnded?.();
        },
      });
      if (voice && !voice.ended) {
        if (closed) voice.stop();
        else voices.add(voice);
      }
      return voice;
    },
    dispose() {
      if (closed) return;
      closed = true;
      const pending = [...voices];
      voices.clear();
      const errors: unknown[] = [];
      for (const voice of pending)
        try {
          voice.stop();
        } catch (error) {
          errors.push(error);
        }
      if (errors.length) throw new AggregateError(errors, 'scene voice cleanup failed');
    },
  };
}
