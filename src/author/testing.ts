import {createSceneActivity} from './scene-activity';
import {LOCAL_LIGHT_CAPS, lightSlotsFor} from './lights';
import {createLightSlots, shadowedSlotsFor, type LightStats} from './light-slots';
import {SHADOWED_LIGHT_CAPS} from './shadow-casting';
import {validateSceneOutput} from './scene-output';
import type {SceneActivityFacts} from './defs';
import {ModelPoseLink} from './model-pose-link';
import {ModelAttachment} from './model-attachment';
import {Model} from './model';
import {Transform} from './defs';
import {authorSaveHandle} from './save-handle';
import {createSaveStore} from '../core/save/store';
import {MemoryBackend} from '../core/save/storage-port';
import {createWorkerHost} from '../platform/workers/host';
import type {AudioClockReading} from '../platform/audio/audio-timeline';
import {BUILT_IN_CUES, normalizeCueVoiceOptions, type CueVoiceOptions} from '../platform/audio/audio-output';
import type {MusicOptions} from '../platform/audio/music-clock';
import {EMITTER_ID, type EmitterSample, type ParticleStats} from './particle-contract';
import {Scatter, SCATTER_ID, scatterRoot, validateScatter, type ScatterData} from './scatter';
import {createScatterAdmission, placeScatter, type ScatterPlacement, type ScatterStats} from './scatter-field';
import {createRng, deriveSeed} from '../core/rng';
/**
 * author/testing.ts: `testScene`, a scene without a browser, for a game's own unit tests. It spawns the scene's
 * entities into a real world and runs its real systems on the real fixed-step runner; input is scripted (`press`,
 * `hold`, `axis`) and saves live in memory. `ctx.text` reads the English strings of `game` (the key itself without one). What a test sees is what a player's frame computes, minus the drawing.
 */
import {createSystemRunner} from '../core/ecs/systems';
import {World, type ComponentType, type Entity} from '../core/ecs/world';
import type {Services} from '../core/services';
import {parseMessage, renderMessage} from '../core/i18n/format';
import type {BuildBrief} from './build';
import {sceneActionHints, defaultActionHints} from './action-hints';
import {completeInput} from './scene-input';
import {bodyOf, spawnInto} from './body';
import {
  Name,
  validatePlayOptions,
  type GameDefinition,
  type InputDefinition,
  type InputState,
  type InputSource,
  type PlayOptions,
  type SceneContext,
  type SceneDefinition,
  type SystemDefinition,
} from './defs';

/** One recorded `ctx.playVoice` of a `testScene`. */
export interface TestVoice {
  id: string;
  options?: Omit<CueVoiceOptions, 'onEnded'>;
}

const defined = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
/**
 * A comparable record of options already normalised as the audio output normalises them: no callback, and no field
 * whose value is `undefined` (a wrapper passing `variant: undefined` records as if it were absent).
 */
function voiceRecord(options: CueVoiceOptions): Omit<CueVoiceOptions, 'onEnded'> {
  const {onEnded: _onEnded, spatial, filter, ...rest} = options;
  return defined({
    ...rest,
    ...(spatial ? {spatial: defined(spatial)} : {}),
    ...(filter ? {filter: defined(filter)} : {}),
  });
}

export interface TestScene {
  readonly activityErrors: readonly unknown[];
  setActivity(facts: Pick<SceneActivityFacts, 'coverage' | 'documentHidden'>): void;
  readonly ctx: SceneContext;
  readonly world: World;
  /** Run `seconds` of frames at 60 fps. */
  run(seconds: number): void;
  /** Press a button action for the next frame; `atMs` (default: the current `ctx.time.now`) is its `pressedAt`. */
  press(action: string, atMs?: number): void;
  /** Hold a button action, or set an axis (-1…1), until released with `release`. */
  hold(action: string, axis?: number): void;
  release(action: string): void;
  /** Where the scene asked to go (`ctx.scene.goto` / `restart`), in order. */
  readonly went: string[];
  /** Audio cues and sound ids played (`ctx.play` and `ctx.playVoice`), in order. */
  readonly cues: string[];
  /**
   * Every `ctx.play`, with its options (checked as the runtime checks them). An id that is neither a built-in cue
   * (`BUILT_IN_CUES`), one of the scene's `sounds`, nor one of `testScene`'s `sounds` throws, naming the id: the
   * browser only warns `no cue or sound '<id>'` in the console and plays nothing.
   */
  readonly plays: {id: string; options?: PlayOptions}[];
  /**
   * Every `ctx.playVoice`, in order, with a copy of its options, normalised and checked by the audio output's own
   * `normalizeCueVoiceOptions` (a spatial position is a plain `[x, y, z]`); `onEnded` and `undefined` fields are left out. Nothing plays: `playVoice` returns null, as a muted page does.
   */
  readonly voices: TestVoice[];
  /** Songs asked for with `ctx.playMusic` (silent: it returns null, and `loadMusic` resolves false). */
  readonly music: {id: string; options?: MusicOptions}[];
  /** The scene's particle field, stepped as in a visit (`engine.particles` after the scene's fixed systems), without
   *  drawing: its counters (null when the scene has no `sceneParticles()`), and every problem it reported (refusals,
   *  invalid emitter data, emitters in a scene without particles); `sample(entity)` is that entity's admitted emitter
   *  now (live count, spawn attempts since admission, bounds of the live particles) or null. */
  readonly particles: {
    readonly stats: ParticleStats | null;
    readonly reports: readonly string[];
    sample(entity: Entity): EmitterSample | null;
  };
  /** The scene's scatters, admitted and placed as in a visit (same stream, density and bounds), without drawing: the
   *  counters (null when the scene has no `sceneScatter()`), every problem reported (refusals, invalid data, scatters
   *  in a scene without scatter), and the kept copies of one entity (null when not admitted). Updated after each
   *  `run` frame and at the start. */
  readonly scatter: {
    readonly stats: ScatterStats | null;
    readonly reports: readonly string[];
    placement(entity: Entity): ScatterPlacement | null;
  };
  /** The scene's local-light slots (VIS-02), admitted after each frame as in a visit: slots, admissions and refusals,
   *  and every refusal reported (each cause once). Nothing is drawn. */
  readonly lights: {readonly stats: LightStats; readonly reports: readonly string[]};
  /** Exit once and dispose the helper-owned save store. Injected services remain caller-owned. */
  dispose(): void;
}

/** `inputs` enables local press-action hints. Defaults report inContext=true; inject services.input for remaps and modal context. */
/** `input` replaces the scripted input with a caller-owned InputState (e.g. a replay log); press/hold/release then throw. */
/** `particleScale` is the `effects.particles` quality knob (default 1, the reference preset). */
/** `scatterDensity` is the `effects.scatter-density` knob (default 1); `seed` also seeds scatter placement as `?seed=`
 *  does in a visit (without it, placement uses the visit default). */
/** `lightCap` is the `lights.local-max` quality knob (default 16, the reference preset); `shadowCap` is
 *  `lights.shadowed-max` (default 4, the reference preset). */
/** `sounds` adds ids `ctx.play` / `ctx.playVoice` may use besides `BUILT_IN_CUES` and the scene's own `sounds`: an
 *  audio asset the scene plays without listing it, or a cue registered by a module the test composes. */
export async function testScene(
  scene: SceneDefinition,
  o: {
    particleScale?: number;
    scatterDensity?: number;
    lightCap?: number;
    shadowCap?: number;
    sounds?: readonly string[];
    brief?: BuildBrief;
    game?: GameDefinition | undefined;
    inputs?: readonly InputDefinition[];
    calm?: boolean;
    params?: Record<string, string>;
    seed?: number;
    systems?: readonly SystemDefinition[];
    services?: Partial<Services>;
    input?: InputSource;
    audioClock?: (nowMs: number) => AudioClockReading | null;
  } = {},
): Promise<TestScene> {
  const body = await bodyOf(scene);
  const hintSource = o.services?.input;
  const describe = sceneActionHints(
    o.inputs ?? [],
    hintSource ? id => hintSource.describeAction(id) : defaultActionHints(o.inputs ?? []),
  );
  const strings: Record<string, string> = Object.assign(
    Object.fromEntries((o.inputs ?? []).map(i => [`game.input.${i.id}`, i.label])),
    ...(o.game?.kits ?? []).map(k => k.strings.en ?? {}),
    o.game?.strings?.en ?? {},
  );
  const world = new World();
  for (const e of body.entities) spawnInto(world, e);
  if (o.sounds !== undefined && (!Array.isArray(o.sounds) || o.sounds.some(id => typeof id !== 'string' || !id)))
    throw Error('testScene: sounds must be a list of ids');
  const playable = new Set([...BUILT_IN_CUES, ...(scene.sounds ?? []), ...(o.sounds ?? [])]);
  const known = (call: string, id: string) => {
    if (playable.has(id)) return;
    throw Error(
      `testScene: ${call}('${String(id)}'): no cue or sound '${String(id)}' in scene ${scene.id}. Built-in cues: ${BUILT_IN_CUES.join(', ')}. ` +
        `A game sound needs defineAsset({ type: 'audio' }) and the scene's sounds (or testScene's sounds option).`,
    );
  };
  const pressed = new Map<string, number>(),
    held = new Map<string, number>(),
    went: string[] = [],
    cues: string[] = [],
    plays: {id: string; options?: PlayOptions}[] = [],
    voices: TestVoice[] = [],
    music: {id: string; options?: MusicOptions}[] = [];
  // No real timers or retained timer callbacks: headless saves flush explicitly.
  const injectedSave = o.services?.save;
  const save =
    injectedSave ??
    createSaveStore({
      local: new MemoryBackend().port(),
      session: new MemoryBackend().port(0, 'session'),
      build: 'test-scene',
      namespace: 'test-scene',
      timers: {set: () => 0, clear: () => {}, now: () => 0},
    });
  const ownsSave = injectedSave == null;
  let disposed = false;
  const alive = () => {
    if (disposed) throw Error('testScene: disposed');
  };
  const scripted = () => {
    if (o.input) throw Error('testScene: input is caller-owned');
  };
  let r = (o.seed ?? 1) >>> 0,
    frame = 0,
    t = 0;
  const ctx: SceneContext = {
    world,
    state: world.resources,
    brief: o.brief as BuildBrief,
    scene: {
      id: scene.id,
      params: o.params ?? {},
      goto: id => {
        went.push(id);
      },
      restart: () => {
        went.push(scene.id);
      },
    },
    input: o.input
      ? completeInput(o.input)
      : {
          describe,
          pressed: id => pressed.has(id),
          pressedAt: id => pressed.get(id) ?? null,
          held: id => held.has(id),
          axis: id => held.get(id) ?? 0,
          pointer: {x: 0, y: 0, down: false, pressed: false},
        },
    get time() {
      return {t, frame, calm: o.calm ?? false, now: t * 1000};
    },
    view: {
      camera: {
        position: [...(scene.view?.camera?.position ?? [0, 8, 10])],
        target: [...(scene.view?.camera?.target ?? [0, 0, 0])],
        fov: scene.view?.camera?.fov ?? 50,
      },
      background: scene.view?.background ?? 0x101820,
      output: validateSceneOutput(scene.view?.output),
      post: scene.view?.post,
      aspect: 16 / 9,
      overlay: null,
      openReadingSheet: null,
    },
    spawn: (prefab, ...extra) => spawnInto(world, prefab, extra),
    named: name => {
      for (const [e, n] of world.query(Name)) if (n.name === name) return e as Entity;
      return undefined;
    },
    save: def => authorSaveHandle(save, def),
    text: (key, vars) => {
      const m = strings[key];
      return m === undefined ? key : renderMessage(parseMessage(m), vars, 'en');
    },
    play: (cue, options) => {
      known('ctx.play', cue);
      validatePlayOptions(options);
      cues.push(cue);
      plays.push({id: cue, ...(options ? {options: structuredClone(options)} : {})});
    },
    modelState: entity => {
      const requested = disposed || !world.has(entity, Transform) ? undefined : world.get(entity, Model);
      return Object.freeze({
        status: requested ? 'loading' : 'absent',
        requestedAsset: requested?.asset ?? null,
        adoptedAsset: null,
      });
    },
    modelAttachmentState: entity =>
      Object.freeze({
        status:
          disposed || !world.has(entity, Transform) || !world.has(entity, Model)
            ? 'absent'
            : world.has(entity, ModelAttachment)
              ? 'unresolved'
              : 'unattached',
        held: false,
      }),
    modelPoseLinkState: entity =>
      Object.freeze({
        status:
          disposed || !world.has(entity, Transform) || !world.has(entity, Model)
            ? 'absent'
            : world.has(entity, ModelPoseLink)
              ? 'unresolved'
              : 'unlinked',
        reason: null,
      }),
    modelSocket: () => null,
    playVoice: (cue, options) => {
      known('ctx.playVoice', cue);
      const normal = normalizeCueVoiceOptions(options);
      cues.push(cue);
      voices.push({id: cue, ...(options ? {options: voiceRecord(normal)} : {})});
      return null;
    },
    audioClock: () => o.audioClock?.(t * 1000) ?? null,
    playMusic: (id, options) => {
      music.push({id, ...(options ? {options: {...options, ...(options.loop ? {loop: {...options.loop}} : {})}} : {})});
      return null;
    },
    loadMusic: async () => false,
    random: () => {
      r = (r + 0x6d2b79f5) >>> 0;
      let x = r;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    },
    service: key => {
      const v = key === 'save' ? save : o.services?.[key];
      if (!v) throw Error(`testScene: no '${String(key)}' service; pass it in services`);
      return v as Services[typeof key];
    },
  };
  const activityErrors: unknown[] = [];
  let activityFacts: SceneActivityFacts = {phase: 'active', coverage: 'top', documentHidden: false};
  const activityEvents = scene.activity
    ? createSceneActivity(
        () => activityFacts,
        facts => scene.activity!(ctx, facts),
        error => activityErrors.push(error),
        dispose,
      )
    : undefined;
  function dispose() {
    if (disposed) return;
    disposed = true;
    activityFacts = {...activityFacts, phase: 'retired'};
    activityEvents?.retire();
    try {
      scene.exit?.(ctx);
    } finally {
      try {
        particles?.dispose();
      } finally {
        if (ownsSave) save.dispose();
      }
    }
  }
  const failures: {id: string; error: unknown}[] = [];
  const particleReports: string[] = [];
  // Particles' own stream (as in a visit with `?seed=`): never the gameplay `ctx.random()`.
  // Any number is a seed, wrapped to 32 bits as `ctx.random` and the browser treat it; the stream exists only with particles.
  const particleRng = scene.particles ? createRng(deriveSeed((o.seed ?? 1) >>> 0, 'particles')) : null;
  const particles =
    scene.particles?.createField({
      scale: o.particleScale ?? 1,
      calm: () => o.calm ?? false,
      seed: () => particleRng!.next(),
      report: error => {
        particleReports.push(error.message);
      },
    }) ?? null;
  const emitterProbe = {id: EMITTER_ID} as ComponentType<object>;
  // Scatter placement and admission, headless: its own derived stream, never `ctx.random()`.
  const scatterReports: string[] = [];
  const scatterAdmission = scene.scatter
    ? createScatterAdmission<Entity>(scene.scatter.limits, error => scatterReports.push(error.message))
    : null;
  const scatterRootSeed = scatterRoot(scene.id, o.seed ?? null),
    scatterDensity = o.scatterDensity ?? 1;
  const placed = new Map<Entity, {data: ScatterData; placement: ScatterPlacement | null}>();
  const scatterProbe = {id: SCATTER_ID} as ComponentType<object>;
  const syncScatter = () => {
    if (!scatterAdmission) {
      if (!scatterReports.length && world.first(scatterProbe))
        scatterReports.push(
          `${scene.id}: a Scatter is not drawn: the scene has no scatter (defineScene({ scatter: sceneScatter() }))`,
        );
      return;
    }
    const offered = [...world.query(Scatter)].filter(([e]) => world.has(e, Transform));
    offered.sort(([a, x], [b, y]) => Number(y.essential) - Number(x.essential) || a - b);
    for (const e of [...placed.keys()])
      if (!offered.some(([x]) => x === e)) {
        placed.delete(e);
        scatterAdmission.release(e);
      }
    for (const [e, data] of offered) {
      if (placed.get(e)?.data === data) continue;
      let placement: ScatterPlacement | null = null;
      try {
        validateScatter(data);
        const p = placeScatter(data, scatterRootSeed, scatterDensity);
        if (scatterAdmission.admit(e, p.count, p.requested)) placement = p;
      } catch (error) {
        scatterAdmission.release(e);
        scatterAdmission.invalid(error);
      }
      placed.set(e, {data, placement});
    }
  };
  const lightReports: string[] = [];
  const lightSlotCounts = lightSlotsFor(scene.lights, o.lightCap ?? LOCAL_LIGHT_CAPS.reference);
  const lightSlots = createLightSlots({
    slots: lightSlotCounts,
    enabled: !!scene.lights,
    shadowed: scene.shadows
      ? shadowedSlotsFor(world, lightSlotCounts, o.shadowCap ?? SHADOWED_LIGHT_CAPS.reference)
      : {point: 0, spot: 0},
    shadows: !!scene.shadows,
    report: message => {
      lightReports.push(`${scene.id}: ${message}`);
    },
  });
  const stepParticles = particles
    ? [{id: 'engine.particles', run: (_: SceneContext, dt: number) => particles.step(world, dt)}]
    : [];
  const runner = createSystemRunner([...body.systems, ...(o.systems ?? []), ...stepParticles], {
    report: (id, error) => {
      failures.push({id, error});
    },
    after: () => world.clearEvents(),
  });
  try {
    await scene.prepare?.(ctx, new AbortController().signal);
    scene.enter?.(ctx);
    activityEvents?.start();
    syncScatter();
  } catch (error) {
    if (ownsSave) save.dispose();
    throw error;
  }
  return {
    ctx,
    world,
    went,
    cues,
    plays,
    voices,
    music,
    activityErrors,
    particles: {
      get stats() {
        return particles?.stats ?? null;
      },
      reports: particleReports,
      sample: entity => particles?.sample(entity) ?? null,
    },
    scatter: {
      get stats() {
        return scatterAdmission ? {...scatterAdmission.stats, refused: {...scatterAdmission.stats.refused}} : null;
      },
      reports: scatterReports,
      placement: entity => placed.get(entity)?.placement ?? null,
    },
    lights: {
      get stats() {
        return lightSlots.stats;
      },
      reports: lightReports,
    },
    setActivity(facts) {
      alive();
      const coverage = facts.coverage,
        documentHidden = facts.documentHidden;
      if (!['top', 'scrim', 'opaque', 'hidden'].includes(coverage) || typeof documentHidden !== 'boolean')
        throw Error('testScene: invalid activity facts');
      activityFacts = {phase: 'active', coverage, documentHidden};
      activityEvents?.refresh();
    },
    run(seconds) {
      alive();
      const n = Math.round(seconds * 60);
      for (let i = 0; i < n; i++) {
        frame++;
        t += 1 / 60;
        runner.frame(ctx, 1 / 60);
        pressed.clear();
        syncScatter();
        lightSlots.sync(world);
        if (!particles && !particleReports.length && world.first(emitterProbe))
          particleReports.push(
            `${scene.id}: an Emitter is not drawn: the scene has no particles (defineScene({ particles: sceneParticles() }))`,
          );
        // Report after the frame: sibling systems, events and tick accounting must finish first.
        const errors = failures.splice(0).map(({id, error}) => {
          let detail = 'unprintable error';
          try {
            detail = String(error);
          } catch {
            /* Preserve the original cause even if formatting fails. */
          }
          return Object.assign(Error(`system ${id} failed: ${detail}`), {cause: error, systemId: id});
        });
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, errors.map(error => error.message).join('; '));
      }
    },
    press: (id, atMs = t * 1000) => {
      alive();
      scripted();
      if (!Number.isFinite(atMs) || atMs < 0) throw Error('testScene: invalid press time');
      if (!pressed.has(id)) pressed.set(id, atMs);
    },
    hold: (id, axis = 1) => {
      alive();
      scripted();
      held.set(id, axis);
    },
    release: id => {
      alive();
      scripted();
      held.delete(id);
    },
    dispose,
  };
}

/** A save store over `TestSaves` memory: what `testScene`'s `services.save` takes. */
export type TestSaveStore = ReturnType<typeof createSaveStore>;

/**
 * Saves that outlive one `testScene`, for reload tests: in-memory local and session storage shared by every store it
 * opens. Pass `store` as `testScene(scene, { services: { save: saves.store } })`, dispose that scene, then
 * `saves.reload()` and start the scene again with the new `store`: it reads what the first one wrote, as a reloaded page
 * does. No real timers run: writes happen at flush points (`{ now: true }`, `flush()`, a reload, `dispose`).
 */
export interface TestSaves {
  /** The current store. It stays caller-owned: `testScene` never disposes an injected store. */
  readonly store: TestSaveStore;
  /**
   * A page reload: the current store is flushed (as `pagehide` flushes a page) and disposed, then a fresh store opens
   * over the same memory and becomes `store`. `{ flush: false }` is a reload that never reached its flush (a crash, a
   * killed tab): writes still pending are lost and storage is left as it was. Dispose the scenes using the old store
   * first: their `exit` may still write.
   */
  reload(options?: {flush?: boolean}): TestSaveStore;
  /** Flushes and disposes the current store (idempotent); `store` and `reload` then throw. */
  dispose(): void;
}

/** In-memory saves shared across `testScene` runs: `reload()` re-opens the store over the same storage. */
export function createTestSaves(): TestSaves {
  const local = new MemoryBackend(),
    session = new MemoryBackend();
  let disposed = false;
  const open = () =>
    createSaveStore({
      local: local.port(),
      session: session.port(0, 'session'),
      build: 'test-scene',
      namespace: 'test-scene',
      timers: {set: () => 0, clear: () => {}, now: () => 0},
    });
  let store = open();
  const alive = () => {
    if (disposed) throw Error('createTestSaves: disposed');
  };
  return {
    get store() {
      alive();
      return store;
    },
    reload(options = {}) {
      alive();
      if (
        options === null ||
        typeof options !== 'object' ||
        (options.flush !== undefined && typeof options.flush !== 'boolean')
      )
        throw Error('createTestSaves: reload options are { flush?: boolean }');
      if (options.flush === false) {
        // A store's dispose always attempts a last flush; a crash never gets one, so storage is put back as it was.
        const kept = [new Map(local.data), new Map(session.data)] as const;
        store.dispose();
        for (const [backend, data] of [
          [local, kept[0]],
          [session, kept[1]],
        ] as const) {
          backend.data.clear();
          for (const [k, v] of data) backend.data.set(k, v);
        }
      } else {
        store.flush('reload');
        store.dispose();
      }
      return (store = open());
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      store.dispose();
    },
  };
}

/** Deterministic worker fallback for headless scene tests; caller owns disposal. */
export const createTestWorkerHost = () => createWorkerHost({createWorker: null});
