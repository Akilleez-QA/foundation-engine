/**
 * author/particle-view.ts: the visit's particle renderer, loaded on first use (FX-01).
 *
 * The particle field (particle-sim.ts) is small and always steps synchronously on the fixed lane, so admission,
 * randomness and despawn never wait for a download. The three.js drawing code (scene-particles.ts) is a separate lazy
 * chunk, requested when the first emitter is admitted (or earlier, with `preload`, when the scene's own entities have
 * one): a game without emitters never downloads it, and the scene runtime chunk stays small. Until it arrives, slots are
 * remembered and nothing is drawn; then each remembered slot is bound and the next interpolated write draws it.
 *
 * Lifetime: owned by the visit. `dispose` (or the signal) drops remembered slots; a module that arrives afterwards is
 * ignored. A failed load (or a renderer that cannot be created) is reported once; queued emitters are dropped and
 * particles keep simulating undrawn for the rest of the visit.
 */
import type { EmitterSlot, ParticleRenderer } from './particle-contract';
import type { SceneParticleOptions, ParticleDrawing } from './scene-particles';

export interface ParticleView extends ParticleRenderer {
  /** Start loading the renderer now (idempotent). */
  preload(): void;
  /** Loaded renderer counters, or zeros before it arrives. */
  readonly stats: ParticleDrawing['stats'];
  /** 'idle' (not requested), 'loading', 'ready' or 'failed'. */
  readonly state: 'idle' | 'loading' | 'ready' | 'failed';
  dispose(): void;
}

const NONE = Object.freeze({ bound: 0, visible: 0, requested: 0, leases: 0, applied: 0, failed: 0 });

export function createParticleView(o: SceneParticleOptions & {
  load: () => Promise<{ createSceneParticles(options: SceneParticleOptions): ParticleDrawing }>;
  /** The renderer arrived and bound waiting emitters: draw again. */
  ready(): void;
}): ParticleView {
  let view: ParticleDrawing | null = null, state: ParticleView['state'] = 'idle', disposed = false;
  const waiting = new Set<EmitterSlot>();
  const report = (error: unknown) => { try { o.report(error); } catch { /* Diagnostics cannot strand cleanup. */ } };
  const preload = () => {
    if (state !== 'idle' || disposed || o.signal.aborted) return;
    state = 'loading';
    o.load().then(m => {
      if (disposed || o.signal.aborted) return;
      try { view = m.createSceneParticles(o); }
      catch (error) { state = 'failed'; waiting.clear(); report(error); return; }
      state = 'ready';
      for (const slot of [...waiting]) { waiting.delete(slot); try { view.bind(slot); } catch (error) { report(error); } }
      o.ready();
    }, error => { if (disposed || o.signal.aborted) return; state = 'failed'; waiting.clear(); report(error); }).catch(report);
  };
  o.signal.addEventListener('abort', () => { waiting.clear(); }, { once: true });
  return {
    preload,
    get stats() { return view?.stats ?? NONE; },
    get state() { return state; },
    bind(slot) {
      if (view) { view.bind(slot); return; }
      if (disposed || o.signal.aborted) throw Error('particles: the visit has ended');
      if (state === 'failed') return;
      waiting.add(slot); preload();
    },
    draw(slot, count) { view?.draw(slot, count); },
    release(slot) { waiting.delete(slot); view?.release(slot); },
    dispose() {
      if (disposed) return;
      disposed = true; waiting.clear();
      view?.dispose();
    },
  };
}
