import type { AudioOutput, CueVoice } from '../../platform/audio/audio-output';
import { createDucking } from './ducking';

export interface CueRequest {
  cue: string;
  variant?: number;
  /** Higher values run first; equal priority preserves insertion order. */
  priority?: number;
  /** Absolute expiration in seconds on the caller's monotonic clock. */
  expiresAt: number;
}
export interface CueMixerOptions {
  output: Pick<AudioOutput, 'playVoice'>;
  /** Total admitted requests, including currently playing cues. */
  maxLogical: number;
  /** Maximum simultaneously playing voices owned by this mixer. */
  maxAudible: number;
}
/** Bounded cue scheduling with actual completion handles; borrows the platform's one output. */
export function createCueMixer(o: CueMixerOptions) {
  for (const n of [o.maxLogical, o.maxAudible]) if (!Number.isSafeInteger(n) || n < 1) throw Error('audio limits must be positive integers');
  if (o.maxAudible > o.maxLogical) throw Error('audible limit exceeds logical limit');
  const pending = new Map<number, CueRequest>(), active = new Map<number, CueVoice>();
  const ducking = createDucking(gain => { for (const voice of active.values()) voice.setGain(gain); });
  let sequence = 0, clock = -Infinity, closed = false, pumping = false;
  const advance = (now: number) => {
    if (!Number.isFinite(now) || now < clock) throw Error('audio clock must be finite and monotonic');
    clock = now;
    for (const [id, request] of pending) if (request.expiresAt <= now) pending.delete(id);
  };
  return {
    /** Null means expired, disposed or full. Unknown cues are dropped by the output at dispatch. */
    request(request: CueRequest, now: number): number | null {
      advance(now);
      if (!request.cue || !Number.isFinite(request.expiresAt) || !Number.isFinite(request.priority ?? 0) || !Number.isSafeInteger(request.variant ?? 0)) throw Error('invalid cue request');
      if (closed || request.expiresAt <= now || pending.size + active.size >= o.maxLogical) return null;
      const id = ++sequence; pending.set(id, { ...request }); return id;
    },
    cancel(id: number): boolean {
      if (pending.delete(id)) return true;
      const voice = active.get(id); if (!voice) return false;
      active.delete(id); voice.stop(); return true;
    },
    /** Call from the existing scene update or event boundary, in seconds. Failed plays are dropped. */
    pump(now: number): number {
      advance(now); if (closed || pumping) return 0;
      pumping = true;
      try {
      const ranked = [...pending].sort((a, b) => (b[1].priority ?? 0) - (a[1].priority ?? 0) || a[0] - b[0]);
      let played = 0;
      for (const [id, request] of ranked) {
        if (closed || active.size >= o.maxAudible) break;
        if (pending.get(id) !== request) continue;
        // Retain admission while the borrowed output calls back into its owner.
        let voice: CueVoice | null;
        try { voice = o.output.playVoice(request.cue, { variant: request.variant, gain: ducking.gain, onEnded: () => active.delete(id) }); }
        catch (error) { pending.delete(id); throw error; }
        const current = !closed && pending.get(id) === request;
        pending.delete(id);
        if (!current) { voice?.stop(); continue; }
        if (voice) { if (!voice.ended) active.set(id, voice); played++; }
      }
      return played;
      } finally { pumping = false; }
    },
    duck: ducking.acquire,
    get stats() { return { pending: pending.size, active: active.size, logical: pending.size + active.size }; },
    dispose() {
      if (closed) return; closed = true; pending.clear();
      const voices = [...active.values()]; active.clear();
      const errors: unknown[] = [];
      for (const voice of voices) { try { voice.stop(); } catch (error) { errors.push(error); } }
      try { ducking.dispose(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'mixer disposal failed');
    },
  };
}
