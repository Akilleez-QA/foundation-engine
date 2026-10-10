import {captureResourceState} from './resource-state';
import {captureInterpolation, Interpolated, presentTransform, type TransformPose} from './interpolation';
import {FrameReadinessError} from '../platform/render/frame-readiness';
import {ProgramLinkError} from '../platform/render/program-validation';
import {t as failureText} from '../core/i18n/app-i18n';
import {createSceneActivity} from './scene-activity';
import {normalizeModelPoseLinkLimits} from './model-pose-link';
import {createSceneModelInspector, inspectModel} from './model-inspection';
import {authorSaveHandle} from './save-handle';
import {createViewSize} from './view-size';
import {createReadingSheets} from './reading-sheet';
import {bindSceneCubes} from './scene-cubes';
import {Model} from './model';
import {bodyHasModel, pendingAttachmentState, pendingModelState, pendingPoseLinkState} from './model-pending';
import {RenderMask, validateRenderMask} from './render-mask';
import {bindEnvironment} from './scene-environment';
import {validateSceneOutput} from './scene-output';
import {createOutputSync} from './scene-output-sync';
import {lightSlotsFor, PointLight, SpotLight} from './lights';
import {createLightSlots, shadowedSlotsFor} from './light-slots';
import {localShadowMapSize, Shadow, shadowFlags, SUN_SHADOW_MAP} from './shadow-casting';
import {applyOutput, outputProfile} from '../platform/render/backends/webgl/output';
import {Material, materialKey} from './material';
import {createSceneSurfaces, type Surface, type SurfaceMaterial} from './scene-materials';
import {createParticleView} from './particle-view';
import {EMITTER_ID, type ParticleField} from './particle-contract';
import {createScenePost, loadPostModule} from './scene-post';
import {openSceneExtension, type SceneExtensionSession} from './scene-extension';
import {SCATTER_ID, scatterRoot} from './scatter';
import type {SceneScatterDrawing} from './scene-scatter';
import {BLOB_SHADOW_ID, sunCoverage} from './blob-shadow';
import type {SceneBlobShadowDrawing} from './scene-blob-shadows';
/**
 * author/runtime.ts: a scene's lazy body, loaded the first time a scene is entered (never in the first-load bundle).
 *
 * One visit of a scene is one activity run (ADR 0032) on the scene shell's host:
 *  - a world (core/ecs) spawned from the scene's entities; its systems run on the one frame loop, `fixed` systems at
 *    a fixed 60 Hz step and `frame` systems once per frame (core/ecs/systems.ts);
 *  - input: each game action is subscribed for the visit; systems read `pressed`, `held`, `axis` and the pointer;
 *  - drawing: entities with `Transform` and `Shape` become meshes on the pooled world surface (a `Material` gives one a
 *    textured, physically based surface: scene-materials.ts). A frame is drawn only when something changed (a
 *    transform, a shape, a material or its arriving texture, the camera, the world's version): render on change
 *    (STD-RUN-9);
 *  - particles: entities with `Transform` and `Emitter` are simulated by the engine's fixed system `engine.particles`
 *    (after the scene's own fixed systems) and drawn as one instanced draw per emitter, interpolated between steps
 *    (particle-sim.ts, scene-particles.ts). A scene without emitters creates nothing for them;
 *  - post-processing: `view.post` (and `ctx.view.post`) at the player's `post.mode` tier, drawn by a lazy chunk inside
 *    the same render-on-change frame (scene-post.ts). A scene without post creates nothing for it;
 *  - render extensions: a kit's extensions listed in `defineScene({ extensions })` open once per visit before program
 *    preparation, sync with the frame, may replace the scene's draw, and close before the scene's tree is released
 *    (scene-extension.ts). A scene without extensions creates nothing for them;
 *  - `enter` runs once the visit is active (ADR 0045), before any of the visit's systems step; `exit` when it is left.
 *    Everything the visit creates is owned
 *    by the run and released in reverse order when it leaves.
 */
import * as T from 'three';
import type {Services} from '../core/services';
import type {SceneRun, SceneVisit} from '../core/router/handover';
import type {ActivityContext, ActivityRun} from '../core/activity/activity';
import type {FrameInfo} from '../core/activity/loop';
import {World, type ComponentType, type Entity} from '../core/ecs/world';
import {createSystemRunner} from '../core/ecs/systems';
import {createRng, deriveSeed} from '../core/rng';
import {appI18n} from '../core/i18n/app-i18n';
import {runRandom} from '../core/run-random';
import {appRenderers} from '../platform/render/renderer-pool';
import {disposeOwnedTree} from '../platform/render/dispose-owned-tree';
import {enterActivity, type SceneParams} from '../platform/ui/scene-shell';
import type {BuildBrief} from './build';
import type {SceneHandle} from './play';
import {TEST_API} from '../core/env';
import {monotonicNow} from '../core/clock';
import {createSystemTiming} from './system-timing';
import {createGpuTimer, type GpuTimer} from '../platform/render/gpu-timer';
import {openSceneTickTap, type SceneTickTap} from './scene-tick-tap';
import {createSceneEntityInspector} from './entity-inspection';
import {actionOf, sceneId} from './ids';
import {bodyOf, spawnInto} from './body';
import {effectiveFov} from './view-math';
import {Mesh} from './mesh';
import {createSceneResources} from './scene-resources';
import {retireRepresentations} from './representation-cleanup';
import {indexedGeometry, replaceIndexedGeometry, releaseIndexed, type IndexedSlot} from './indexed-geometry';
import {createPrimitiveGeometries, type PrimitiveGeometryLease} from './primitive-geometries';
import {createSceneVoices} from './scene-audio';
import type {MusicOptions, MusicVoice} from '../platform/audio/music-clock';
import {sceneInput} from './scene-input';
import {appLayers} from '../platform/ui/runtime';
import {sceneActionHints} from './action-hints';
import {bindScenePointer} from './scene-pointer';
import {createPressLatch} from './press-latch';
import type {LayerHandle, LayerSpec} from '../platform/ui/layers';
import {viewOwnsInput} from '../platform/input/owner';
import {
  Name,
  Shape,
  Transform,
  PLAY_LATE_MS,
  validatePlayOptions,
  type InputDefinition,
  type PlayOptions,
  type SceneContext,
  type SceneDefinition,
  type ViewState,
} from './defs';
import type {CueVoiceOptions} from '../platform/audio/audio-output';

const NO_SHADOW = Object.freeze({cast: false, receive: false});
/** The fixed lane's step (core/ecs/systems.ts default), named so a replay header can record it. */
const FIXED_STEP = 1 / 60;
/** How long a scene with post waits for its chunk before its first picture; later, it arrives with one redraw. */
const POST_WAIT_MS = 4000;
const seedFromAddress = (): number | null => {
  if (typeof location === 'undefined') return null;
  const s = new URLSearchParams(location.search).get('seed');
  return s !== null && /^\d+$/.test(s) ? Number(s) : null;
};

/** `ctx.play` options as a voice request: fire and forget, so a file still loading may start a little late. */
const voiceOptions = (o: PlayOptions | undefined): CueVoiceOptions => ({
  wait: PLAY_LATE_MS,
  ...(o?.volume !== undefined ? {gain: o.volume} : {}),
  ...(o?.pitch !== undefined ? {rate: o.pitch} : {}),
  ...(o?.position ? {spatial: {position: [...o.position] as [number, number, number]}} : {}),
});

/** The scatter drawing chunk, once a scene that opted in has prepared (so its first frame already draws scatters). */
let scatterModule: typeof import('./scene-scatter') | null = null;
const loadScatter = () =>
  import('./scene-scatter').then(m => {
    scatterModule = m;
    return m;
  });

/** The blob shadow chunk (VIS-10), once a scene that opted in has prepared (so its first frame already draws blobs). */
let blobModule: typeof import('./scene-blob-shadows') | null = null;
const loadBlobs = () =>
  import('./scene-blob-shadows').then(m => {
    blobModule = m;
    return m;
  });

/** Model presentation is a lazy chunk too: loaded while a scene that starts with a `Model` entity prepares, else when a
 *  system first spawns one. Once loaded, every later visit starts its models synchronously. */
let modelModule: typeof import('./scene-model-chunk') | null = null;
const loadModels = () =>
  import('./scene-model-chunk').then(m => {
    modelModule = m;
    return m;
  });

const preparations = new WeakMap<
  SceneVisit,
  {body: Awaited<ReturnType<typeof bodyOf>>; state: Record<string, unknown>}
>();
/** CPU/data preflight cannot allocate a second render surface or issue gameplay input. */
export async function prepareScene(s: Services, scene: SceneDefinition, visit: SceneVisit): Promise<void> {
  // Sound files start loading with the scene; a failure is reported by the output and never blocks the visit.
  if (scene.sounds?.length && s.app.has('platform.audio'))
    for (const id of scene.sounds) void s.audio.preload(id, visit.signal);
  // The post chunk starts loading with the scene; the visit reports a failure (scene-post.ts).
  if (scene.view?.post) loadPostModule().catch(() => {});
  // Scatter drawing is a lazy chunk; a scene that opted in loads it while it prepares. A failure is reported at entry.
  const scatterLoad = scene.scatter && !scatterModule ? loadScatter().catch(() => null) : null;
  // Blob shadows are a lazy chunk too; a failure is reported at entry and the visit draws without them.
  const blobLoad = scene.blobShadows && !blobModule ? loadBlobs().catch(() => null) : null;
  const body = await bodyOf(scene),
    state: Record<string, unknown> = {};
  // A failed model chunk is reported at entry, where the scene's models report `failed`.
  if (!modelModule && bodyHasModel(body.entities)) await loadModels().catch(() => null);
  await scatterLoad;
  await blobLoad;
  if (visit.signal.aborted) return;
  await scene.prepare?.(
    {state, text: (key, vars) => (appI18n.t as (k: string, v?: unknown) => string)(key, vars), service: key => s[key]},
    visit.signal,
  );
  if (!visit.signal.aborted) preparations.set(visit, {body, state});
}

export async function enterScene(o: {
  s: Services;
  brief: BuildBrief;
  scene: SceneDefinition;
  visit: SceneVisit;
  inputs: readonly InputDefinition[];
}): Promise<SceneRun> {
  const {s, brief, scene, visit} = o;
  const prepared = preparations.get(visit);
  const body = prepared?.body ?? (await bodyOf(scene));
  if (!modelModule && bodyHasModel(body.entities)) await loadModels().catch(() => null);
  // Local lights (VIS-02) and shadows (VIS-03) are a lazy chunk: only a scene with `sceneLights()` or `sceneShadows()`
  // loads the rig (and the shadow scheduler) before its first frame; every other scene carries none of it.
  const lightModule = scene.lights || scene.shadows ? await import('./scene-light-rig') : null;
  // The gradient sky (VIS-05) is a lazy chunk too: loaded now when the scene starts with one, or later when an
  // environment first asks for one (that sky then appears one frame after its chunk arrives).
  let skyModule = scene.view?.environment?.sky ? await import('./scene-sky') : null;
  preparations.delete(visit);
  let ctxRef: SceneContext | null = null;
  let activityStart: (() => void) | undefined;
  let tapArrive: (() => void) | undefined;
  // Set once arrival has run `enter`: no system of this visit steps before it, on a first entry or a re-entry.
  let arrived = false;
  const activity = {
    id: sceneId(scene.id),
    kind: 'scene' as const,
    enter(actx: ActivityContext, {mount}: SceneParams): ActivityRun {
      const doc = mount.ownerDocument;
      const view = doc.createElement('div');
      view.className = 'scene-view';
      view.setAttribute('data-scene', scene.id);
      view.tabIndex = 0;
      const overlay = doc.createElement('div');
      overlay.className = 'scene-overlay';
      mount.append(view);
      view.append(overlay);
      actx.own(() => view.remove());
      const sceneLayerSpec: LayerSpec = {
        id: actx.runId,
        kind: 'scene',
        element: view,
        cover: 'opaque',
        modal: false,
        dormant: true,
      };
      const sceneLayer = actx.layer(sceneLayerSpec) as LayerHandle;
      // Output (tone mapping, exposure) is part of the lease profile; the defaults are a fresh renderer's own values.
      const initialOutput = validateSceneOutput(scene.view?.output);
      const surface = appRenderers().lease({
        role: 'world',
        host: view,
        insert: 'prepend',
        ctx: actx,
        profile: {
          clearColor: scene.view?.background ?? 0x101820,
          outputColorSpace: T.SRGBColorSpace,
          ...outputProfile(initialOutput),
          // Shadows (VIS-03) only for a scene that opted in; PCF filtering, with each light's radius for softness.
          ...(scene.shadows ? {shadowMap: {enabled: true, type: T.PCFShadowMap}} : {}),
        },
      });
      if (!surface) throw Error(`${scene.id}: WebGL could not start`);
      const renderer = surface.renderer;
      // KTX2 model textures are transcoded for this visit's renderer formats; nothing loads until a model needs it.
      s.models.bindRenderer?.(renderer, actx.signal);

      const three = new T.Scene();
      actx.own(() => disposeOwnedTree(three));
      const defaultLights: T.Light[] = [];
      if ((scene.view?.lights ?? 'default') === 'default') {
        const ambient = new T.HemisphereLight(0xffffff, 0x445566, 1.6);
        const sun = new T.DirectionalLight(0xffffff, 1.4);
        sun.position.set(4, 9, 6);
        defaultLights.push(ambient, sun);
        three.add(ambient, sun);
        for (const light of defaultLights) light.visible = !scene.view?.environment;
      }
      const camera = new T.PerspectiveCamera(scene.view?.camera?.fov ?? 50, 1, 0.1, 500);
      const sizes = createViewSize(
        actx.signal,
        () => ({width: Math.max(1, view.clientWidth), height: Math.max(1, view.clientHeight)}),
        error => s.log.error(`${scene.id}: viewport observer failed`, error),
      );
      const viewState: ViewState = {
        observeSize: sizes.observe,
        camera: {
          position: [...(scene.view?.camera?.position ?? [0, 8, 10])],
          target: [...(scene.view?.camera?.target ?? [0, 0, 0])],
          fov: scene.view?.camera?.fov ?? 50,
          mask: scene.view?.camera?.mask ?? 1,
          ...(scene.view?.camera?.minWidthFov ? {minWidthFov: scene.view.camera.minWidthFov} : {}),
        },
        background: scene.view?.background ?? 0x101820,
        environment: scene.view?.environment,
        output: {...initialOutput},
        post: scene.view?.post,
        overlay,
        signal: actx.signal,
        openReadingSheet: options => readingSheets.open(options),
        get aspect() {
          return camera.aspect;
        },
      };

      const output = createOutputSync(
        viewState.output,
        next => applyOutput(renderer, next),
        error => s.log.error(`${scene.id}: view.output refused`, error),
      );
      // The sun's shadow (VIS-03): a scene with `sceneShadows()` lets its environment's `directional.shadow` cast.
      const sunShadow = scene.shadows && lightModule ? lightModule.createSunShadow(renderer, SUN_SHADOW_MAP) : null;
      actx.own(() => sunShadow?.dispose());
      const sunShadowApply = sunShadow ? sunShadow.apply : undefined;
      let sunShadowReported = false;
      const skyLayer = () => skyModule?.createSkyLayer(three) ?? null;
      let skyLoading = false;
      let environment = scene.view?.environment ? bindEnvironment(three, sunShadowApply, skyLayer) : null;
      actx.own(() => environment?.dispose());
      const cubes = bindSceneCubes(
        three,
        s.assets,
        actx.signal,
        () => {
          dirty = true;
          actx.invalidate();
        },
        error => s.log.error(`${scene.id}: background failed`, error),
      );
      actx.own(() => cubes.dispose());

      // The world and its entities.
      const world = new World();
      if (prepared) Object.assign(world.resources, prepared.state);
      for (const e of body.entities) spawnInto(world, e);

      // Input: every game action is owned by this visit; a press is kept for the frame that reads it and, across
      // zero-step frames, for the next fixed tick (press-latch.ts, STD-SIM-12), with its event timestamp (page
      // monotonic ms) for ctx.input.pressedAt.
      const pressed = createPressLatch(),
        input = s.input;
      // A game action press from a key is a user gesture: a keyboard-only player can unlock audio (pointers already do;
      // browsers may not count a gamepad press, and then unlock() changes nothing).
      const unlockAudio = () => {
        if (s.app.has('platform.audio') && !actx.signal.aborted) s.audio.unlock();
      };
      const stampOf = (at: number) => (Number.isFinite(at) && at > 0 ? at : monotonicNow());
      const press = (id: string, at: number) => pressed.add(id, stampOf(at));
      for (const i of o.inputs) {
        if (i.axis)
          for (const side of ['negative', 'positive'] as const)
            input.onAction(
              actionOf(i.id, side),
              () => {
                actx.invalidate();
                return true;
              },
              {owner: actx.runId, signal: actx.signal},
            );
        else
          input.onAction(
            actionOf(i.id),
            e => {
              if (e.phase === 'press') {
                press(i.id, e.t);
                unlockAudio();
              }
              if (e.phase !== 'repeat') actx.invalidate();
              return true;
            },
            {owner: actx.runId, signal: actx.signal},
          );
      }
      const ownsInput = () =>
        !actx.signal.aborted && actx.coverage() === 'top' && viewOwnsInput(view) && !view.closest('.view-covered');
      const gestures = bindScenePointer(surface.canvas, {
        signal: actx.signal,
        owns: ownsInput,
        press: at => {
          pressed.pointerPressed(stampOf(at));
          for (const i of o.inputs) if (i.tap) press(i.id, at);
        },
        canceled: () => pressed.clear(),
        blocked: () => input.cancel('overlay'),
        invalidate: () => actx.invalidate(),
      });
      const pointer = pressed.pointer(gestures.pointer);
      input.onCancel(() => gestures.cancel(), actx.signal);
      actx.own(() => gestures.dispose());
      const readingSheets = createReadingSheets(actx, overlay, {
        canOpen: ownsInput,
        cancelInput: () => {
          pressed.clear();
          gestures.cancel();
          input.cancel('overlay');
        },
      });
      actx.own(() => readingSheets.dispose());

      const seed = seedFromAddress();
      const rng = seed === null ? null : createRng(seed);
      const random = () => (rng ?? runRandom.stream(`scene.${scene.id}`)).next();
      const liveInput = sceneInput(
        ownsInput,
        id => input.held(id),
        pressed,
        pointer,
        sceneActionHints(o.inputs, id => input.describeAction(id)),
      );
      // Dev/test only: a replay tool may record or drive this visit's fixed ticks (scene-tick-tap.ts).
      let tap: SceneTickTap | null = null;
      if (TEST_API) {
        try {
          tap = openSceneTickTap({
            scene: scene.id,
            game: {id: s.play.game.id, version: s.play.game.version},
            inputs: o.inputs.map(i => ({id: i.id, axis: !!i.axis})),
            seed,
            step: FIXED_STEP,
            world,
            replayDigest: scene.replay?.digest ?? null,
            live: liveInput,
            invalidate: () => actx.invalidate(),
          });
        } catch (error) {
          s.log.error(`${scene.id}: tick tap failed`, error);
        }
        if (tap) {
          const owned = tap;
          actx.own(() => owned.retire());
          tapArrive = () => owned.arrive();
        }
      }
      let frame = 0,
        t = 0,
        calm = false,
        frameMs = monotonicNow();
      const voices = createSceneVoices((cue, options) =>
        !s.app.has('platform.audio') || actx.signal.aborted ? null : s.audio.playVoice(cue, options),
      );
      actx.own(() => voices.dispose());
      const songs = createSceneVoices<MusicVoice, MusicOptions>((id, options) =>
        !s.app.has('platform.audio') || actx.signal.aborted ? null : s.audio.playMusic(id, options),
      );
      actx.own(() => songs.dispose());
      // Render interpolation (author/interpolation.ts): the runner's alpha once it exists, 0 before.
      let alphaSource = () => 0;
      const present = (e: Entity, tr: TransformPose) => presentTransform(tr, world.get(e, Interpolated), alphaSource());
      const ctx: SceneContext = {
        world,
        state: world.resources,
        brief,
        scene: {
          id: scene.id,
          params: visit.params,
          goto: (id, params) => {
            void s.router.go(sceneId(id), params ? {params} : {});
          },
          restart: () => {
            void s.router.go(sceneId(scene.id), {params: {...visit.params}, again: 'reenter'});
          },
        },
        input: tap ? tap.input : liveInput,
        get time() {
          return {t, frame, calm, now: frameMs, alpha: alphaSource()};
        },
        view: viewState,
        spawn: (prefab, ...extra) => spawnInto(world, prefab, extra),
        named: name => {
          for (const [e, n] of world.query(Name)) if (n.name === name) return e;
          return undefined;
        },
        save: def => authorSaveHandle(s.save, def),
        text: (key, vars) => (appI18n.t as (k: string, v?: unknown) => string)(key, vars),
        play: (cue, options) => {
          validatePlayOptions(options);
          voices.play(cue, voiceOptions(options));
        },
        playVoice: (cue, options) => voices.play(cue, options),
        modelState: entity =>
          models ? models.state(entity) : pendingModelState(world, entity, actx.signal.aborted, modelsFailed),
        modelAttachmentState: entity =>
          models ? models.attachmentState(entity) : pendingAttachmentState(world, entity, actx.signal.aborted),
        modelPoseLinkState: entity =>
          models ? models.poseLinkState(entity) : pendingPoseLinkState(world, entity, actx.signal.aborted),
        modelSocket: (entity, name) => models?.socket(entity, name) ?? null,
        random,
        audioClock: () => (!s.app.has('platform.audio') || actx.signal.aborted ? null : s.audio.clock()),
        playMusic: (id, options) => songs.play(id, options),
        loadMusic: id =>
          !s.app.has('platform.audio') || actx.signal.aborted
            ? Promise.resolve(false)
            : s.audio.loadMusic(id, actx.signal),
        service: key => s[key],
      };
      ctxRef = ctx;
      const activityEvents = scene.activity
        ? createSceneActivity(
            () => ({
              phase: actx.leaving() || visit.signal.aborted ? 'retired' : 'active',
              coverage: actx.coverage(),
              documentHidden: doc.hidden,
            }),
            facts => scene.activity!(ctx, facts),
            error => s.log.error(`${scene.id}: activity hook failed`, error),
            () => actx.leave('error'),
          )
        : undefined;
      if (activityEvents) {
        const refresh = () => {
          if (actx.leaving() || visit.signal.aborted) activityEvents.retire();
          else activityEvents.refresh();
        };
        actx.own(appLayers(doc).onChange(refresh));
        doc.addEventListener('visibilitychange', refresh);
        actx.own(() => doc.removeEventListener('visibilitychange', refresh));
        activityStart = () => {
          if (!actx.leaving() && visit.current()) activityEvents.start();
        };
        actx.own(() => activityEvents.retire());
      }

      // Drawing: meshes follow Transform + Shape; draw only when something changed.
      const resources = createSceneResources();
      const geometries = createPrimitiveGeometries(resources);
      const meshes = new Map<Entity, {mesh: T.Mesh; geometry: PrimitiveGeometryLease; surface: Surface; sig: string}>();
      // Anisotropy is a 'reenter-scene' knob: read once per visit, capped by what the context supports.
      const anisotropy = Math.min(
        s.quality.knob('textures.anisotropy'),
        renderer.capabilities?.getMaxAnisotropy?.() ?? 1,
      );
      const surfaces = createSceneSurfaces({
        library: s.assets,
        resources,
        signal: actx.signal,
        anisotropy,
        changed: () => {
          dirty = true;
          actx.invalidate();
        },
        report: error => s.log.error(`${scene.id}: material texture failed`, error),
      });
      // Indexed meshes own their geometry/material individually; detach before general tree cleanup.
      const indexed = new Map<Entity, IndexedSlot>();
      actx.own(() => {
        const indexedMeshes = [...indexed.values()],
          primitiveMeshes = [...meshes.values()];
        indexed.clear();
        meshes.clear();
        retireRepresentations(
          three,
          [...indexedMeshes, ...primitiveMeshes].map(({mesh}) => mesh),
          [
            ...[...primitiveMeshes, ...indexedMeshes].map(
              ({surface}) =>
                () =>
                  surface?.dispose(),
            ),
            () => geometries.dispose(),
            () => resources.dispose(),
          ],
        );
      });
      let lastCamera = '',
        lastVersion = -1,
        dirty = true;
      const syncListener = () => {
        if (actx.signal.aborted || !s.app.has('platform.audio') || actx.coverage() !== 'top') return;
        const forward = new T.Vector3();
        camera.getWorldDirection(forward);
        const up = new T.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        s.audio.setListener(
          camera.position.toArray() as [number, number, number],
          forward.toArray() as [number, number, number],
          up.toArray() as [number, number, number],
        );
      };
      actx.own(
        appLayers(doc).onChange(() => {
          syncListener();
          gestures.sync();
        }),
      );
      const maskOf = (e: Entity) => validateRenderMask(world.get(e, RenderMask)?.mask ?? 1);
      // Models (the lazy `scene-model-chunk`): started now when the chunk is here (the scene started with a model, or an
      // earlier visit loaded it), else on the first sync that sees a `Model` entity. Until then the context answers as
      // for a model not admitted yet (model-pending.ts).
      let models: ReturnType<typeof import('./scene-model-chunk').createSceneModels> | null = null,
        modelsRequested = false,
        modelsFailed = false;
      const startModels = (m: typeof import('./scene-model-chunk')) => {
        if (actx.signal.aborted || models) return;
        const looks = m.createModelLooks({
          world,
          surfaces,
          resources,
          report: error => s.log.error(`${scene.id}: model material failed`, error),
        });
        const owner = m.createSceneModels({
          looks,
          poseLinks:
            scene.modelPoseLinks === undefined ? undefined : normalizeModelPoseLinkLimits(scene.modelPoseLinks),
          inspection: TEST_API ? inspectModel : undefined,
          world,
          scene: three,
          library: s.models,
          signal: actx.signal,
          mask: maskOf,
          invalidate: () => {
            dirty = true;
            actx.invalidate();
          },
          report: error => s.log.error(`${scene.id}: model failed`, error),
          present,
        });
        models = owner;
        actx.own(() => owner.dispose());
      };
      const requestModels = () => {
        if (models || modelsRequested) return;
        modelsRequested = true;
        (modelModule ? Promise.resolve(modelModule) : loadModels()).then(
          m => {
            startModels(m);
            dirty = true;
            actx.invalidate();
          },
          error => {
            if (actx.signal.aborted) return;
            modelsFailed = true;
            s.log.error(`${scene.id}: model presentation failed to load`, error);
          },
        );
      };
      if (modelModule) startModels(modelModule);
      // Particles (FX-01): the field is pure and visit-owned and steps on the fixed lane; its renderer (one hidden mesh
      // per admitted emitter) is a lazy chunk, requested by the first admitted emitter, or now when the scene's own
      // entities have one. The density knob is 'reenter-scene': read once per visit.
      const particleView = createParticleView({
        scene: three,
        library: s.assets,
        signal: actx.signal,
        load: () => import('./scene-particles'),
        changed: () => {
          dirty = true;
          actx.invalidate();
        },
        // Bound emitters draw from their next step's write; arrival itself changes no pixel.
        ready: () => {
          actx.invalidate();
        },
        bindFailed: (slot, error) => particles?.bindFailed(slot, error),
        report: error => s.log.error(`${scene.id}: particle drawing failed`, error),
      });
      // Only a scene that opted in (`sceneParticles()`) has a field; elsewhere an emitter is reported once, never drawn.
      // Particles draw from their own stream, never the gameplay one, so adding an effect cannot shift `ctx.random()`
      // or an existing `?seed=` replay: derived from the seed when there is one, else the visit's named stream.
      const particleRng = seed === null ? null : createRng(deriveSeed(seed >>> 0, 'particles'));
      const particleSeed = () => (particleRng ?? runRandom.stream(`scene.${scene.id}.particles`)).next();
      const particles: ParticleField | null = scene.particles
        ? scene.particles.createField({
            scale: s.quality.knob('effects.particles'),
            // Calm from the frame (STD-RUN-8), read at each step: presentation only, never the particles' stream.
            calm: () => calm,
            seed: particleSeed,
            report: error => s.log.error(`${scene.id}: particles`, error),
            renderer: particleView,
          })
        : null;
      // Scatter: one instanced draw per admitted `Scatter`, in scenes that opted in (`sceneScatter()`); placement draws
      // from a stream derived from the scene id and `?seed=`, never the gameplay one. The density knob is read once.
      let scatter: SceneScatterDrawing | null = null;
      const startScatter = (m: typeof import('./scene-scatter')) => {
        if (actx.signal.aborted || scatter || !scene.scatter) return;
        scatter = m.createSceneScatter({
          world,
          scene: three,
          limits: scene.scatter.limits,
          root: scatterRoot(scene.id, seed),
          density: s.quality.knob('effects.scatter-density'),
          surfaces,
          geometries,
          resources,
          mask: maskOf,
          report: error => s.log.error(`${scene.id}: scatter`, error),
        });
      };
      if (scene.scatter) {
        if (scatterModule) startScatter(scatterModule);
        else
          loadScatter().then(
            m => {
              startScatter(m);
              dirty = true;
              actx.invalidate();
            },
            error => {
              if (!actx.signal.aborted) s.log.error(`${scene.id}: scatter drawing failed to load`, error);
            },
          );
        actx.own(() => scatter?.dispose());
      }
      const scatterProbe = {id: SCATTER_ID} as ComponentType<object>;
      let scatterReported = false;
      // Blob shadows (VIS-10): one instanced draw of every `BlobShadow` in a scene with `sceneBlobShadows()`. Synced
      // after the camera and environment each frame, since the sun's live shadow decides which blobs stand in for it.
      let blobs: SceneBlobShadowDrawing | null = null;
      const startBlobs = (m: typeof import('./scene-blob-shadows')) => {
        if (actx.signal.aborted || blobs || !scene.blobShadows) return;
        blobs = m.createSceneBlobShadows({
          world,
          scene: three,
          limits: scene.blobShadows.limits,
          shadows: scene.shadows,
          report: message => s.log.info(`${scene.id}: ${message}`),
        });
      };
      if (scene.blobShadows) {
        if (blobModule) startBlobs(blobModule);
        else
          loadBlobs().then(
            m => {
              startBlobs(m);
              dirty = true;
              actx.invalidate();
            },
            error => {
              if (!actx.signal.aborted) s.log.error(`${scene.id}: blob shadows failed to load`, error);
            },
          );
        actx.own(() => blobs?.dispose());
      }
      const blobProbe = {id: BLOB_SHADOW_ID} as ComponentType<object>;
      let blobsReported = false;
      const emitterProbe = {id: EMITTER_ID} as ComponentType<object>;
      let emittersReported = false;
      // Local lights (VIS-02): a scene with `sceneLights()` gets a fixed rig of slots for this visit, capped by the
      // 'reenter-scene' knob `lights.local-max`; a scene without it creates no light and reports its lights once.
      // Shadowed slots (VIS-03) are chosen once, from the scene's own lights, bounded by `lights.shadowed-max`.
      const lightSlotCounts = lightSlotsFor(scene.lights, scene.lights ? s.quality.knob('lights.local-max') : 0);
      const shadowCap = scene.shadows ? s.quality.knob('lights.shadowed-max') : 0;
      const shadowedSlots = scene.shadows ? shadowedSlotsFor(world, lightSlotCounts, shadowCap) : {point: 0, spot: 0};
      const lightSlots = createLightSlots({
        slots: lightSlotCounts,
        requested: scene.lights?.limits,
        enabled: !!scene.lights,
        shadowed: shadowedSlots,
        shadows: !!scene.shadows,
        // A tier refusal (a non-essential light beyond a lighter preset's slots) is designed behaviour: info, once.
        report: (message, level) =>
          level === 'info' ? s.log.info(`${scene.id}: ${message}`) : s.log.error(`${scene.id}: ${message}`),
      });
      const lightRig =
        lightModule && scene.lights
          ? lightModule.createSceneLightRig(
              three,
              lightSlotCounts,
              scene.shadows ? {shadowed: shadowedSlots, mapSize: localShadowMapSize(shadowCap), renderer} : undefined,
            )
          : null;
      actx.own(() => lightRig?.dispose());
      // Preload whenever the scene opted in: a runtime-spawned first burst must not wait for (and miss) the chunk.
      if (particles) particleView.preload();
      actx.own(() => {
        try {
          particles?.dispose();
        } finally {
          particleView.dispose();
        }
      });
      // Post-processing (`view.post`): the chunk loads when the scene has settings; `off` and a still-loading or
      // failed chunk draw direct. The `post.mode` knob is live: a change asks for a frame, and sync() decides whether
      // the picture changed. MSAA on the scene target follows `resolution.antialias`.
      const post = createScenePost({
        renderer,
        backend: brief.render.backend,
        signal: actx.signal,
        samples: () => (s.quality.knob('resolution.antialias') ? 4 : 0),
        changed: () => {
          dirty = true;
          actx.invalidate();
        },
        report: error => s.log.error(`${scene.id}: post-processing`, error),
      });
      actx.own(() => post.dispose());
      s.quality.subscribe(() => {
        if (viewState.post) actx.invalidate();
      }, actx.signal);
      // Render extensions (`defineScene({ extensions })`, made by a kit: scene-extension.ts). Each opens once, now, so
      // its objects are part of program preparation; a session that throws is reported and closed for the visit.
      // Closed first when the visit ends (registered after the scene tree's own release, so it runs before it).
      type OpenExtension = {id: string; session: SceneExtensionSession | null};
      const extensions: OpenExtension[] = [];
      const closeExtension = (x: OpenExtension, error?: unknown) => {
        const session = x.session;
        x.session = null;
        if (error !== undefined) s.log.error(`${scene.id}: extension ${x.id} failed; closed for this visit`, error);
        try {
          session?.dispose();
        } catch (cleanup) {
          s.log.error(`${scene.id}: extension ${x.id} cleanup failed`, cleanup);
        }
        dirty = true;
      };
      for (const extension of scene.extensions ?? []) {
        const x: OpenExtension = {id: extension.id, session: null};
        extensions.push(x);
        try {
          x.session = openSceneExtension(extension, {
            scene: three,
            camera,
            renderer,
            canvas: surface.canvas,
            backend: brief.render.backend,
            ctx,
            world,
            kits: (s.play.game.kits ?? []).map(k => k.id),
            dev: TEST_API,
            signal: actx.signal,
            time: () => ({t, calm}),
            mask: maskOf,
            invalidate: () => {
              dirty = true;
              actx.invalidate();
            },
            report: error => s.log.error(`${scene.id}: extension ${extension.id}`, error),
          });
        } catch (error) {
          s.log.error(`${scene.id}: extension ${extension.id} could not open`, error);
        }
      }
      actx.own(() => {
        for (const x of [...extensions].reverse()) closeExtension(x);
      });
      const extensionsBusy = () => extensions.some(x => !!x.session?.busy());
      /** A session's own draw of the frame (a render override), else false: the scene draws. */
      const drawOverride = () => {
        for (const x of extensions)
          if (x.session?.render)
            try {
              if (x.session.render()) return true;
            } catch (error) {
              if (error instanceof ProgramLinkError || error instanceof FrameReadinessError) throw error;
              closeExtension(x, error);
            }
        return false;
      };
      const sync = (dt = 0) => {
        if (actx.signal.aborted) return;
        actx.setFrameMode(
          body.systems.length ||
            [...world.query(Model)].some(([, m]) => m.playing && !!m.clip && m.speed > 0) ||
            !!particles?.busy(world) ||
            extensionsBusy()
            ? 'continuous'
            : 'on-demand',
        );
        if (models) {
          if (models.sync(dt)) dirty = true;
        } else if (!modelsRequested && world.first(Model) !== undefined) requestModels();
        if (scatter?.sync()) dirty = true;
        if (actx.signal.aborted) return;
        const seen = new Set<Entity>();
        for (const [e, tr, sh] of world.query(Transform, Shape)) {
          if (world.has(e, Mesh) || world.has(e, Model)) continue; // Deterministic precedence; never draw two representations.
          seen.add(e);
          const p = present(e, tr);
          const look = world.get(e, Material),
            lookKey = look ? materialKey(look) : '';
          const shade = scene.shadows ? shadowFlags(scene.shadows, world.get(e, Shadow)) : NO_SHADOW;
          const sig = `${p.x},${p.y},${p.z},${p.rx},${p.ry},${p.rz},${p.scale},${sh.kind},${sh.size},${sh.color},${sh.visible},${maskOf(e)},${lookKey},${shade.cast},${shade.receive}`;
          let m = meshes.get(e);
          if (!m) {
            const geometry = geometries.acquire(sh.kind, sh.size);
            let surface: Surface | undefined;
            let mesh: T.Mesh | undefined;
            try {
              surface = surfaces.create(look, sh.color);
              mesh = new T.Mesh(geometry.geometry, surface.material);
              mesh.name = world.get(e, Name)?.name ?? `e${e}`;
              three.add(mesh);
              meshes.set(e, (m = {mesh, geometry, surface, sig: ''}));
            } catch (error) {
              const errors = [error];
              try {
                if (mesh) three.remove(mesh);
              } catch (cleanup) {
                errors.push(cleanup);
              }
              try {
                geometry.release();
              } catch (cleanup) {
                errors.push(cleanup);
              }
              try {
                surface?.dispose();
              } catch (cleanup) {
                errors.push(cleanup);
              }
              if (errors.length > 1) throw new AggregateError(errors, 'primitive construction failed');
              throw error;
            }
          }
          if (m.sig === sig) continue;
          const {mesh} = m;
          if (m.geometry.key !== `${sh.kind}:${sh.size}`) {
            const replacement = geometries.acquire(sh.kind, sh.size);
            const previous = m.geometry;
            mesh.geometry = replacement.geometry;
            m.geometry = replacement;
            dirty = true;
            previous.release();
            if (actx.signal.aborted) return;
            if (meshes.get(e) !== m || m.geometry !== replacement) continue;
          }
          if (m.surface.key !== lookKey && !m.surface.update(look)) {
            // Only a change of kind (Material added, removed or made invalid) needs a new surface.
            const previous = m.surface;
            m.surface = surfaces.create(look, sh.color);
            mesh.material = m.surface.material;
            previous.dispose();
            if (actx.signal.aborted) return;
          }
          mesh.position.set(p.x, p.y, p.z);
          mesh.rotation.set(p.rx, p.ry, p.rz);
          mesh.scale.setScalar(p.scale);
          m.surface.material.color.setHex(sh.color);
          mesh.visible = sh.visible;
          mesh.layers.mask = maskOf(e);
          mesh.castShadow = shade.cast;
          mesh.receiveShadow = shade.receive;
          m.sig = sig;
          dirty = true;
        }
        for (const [e, m] of [...meshes])
          if (!seen.has(e) && meshes.get(e) === m) {
            meshes.delete(e);
            dirty = true;
            const geometry = m.geometry,
              surface = m.surface;
            retireRepresentations(three, [m.mesh], [() => geometry.release(), () => surface.dispose()]);
            if (actx.signal.aborted) return;
          }
        const indexedSeen = new Set<Entity>();
        for (const [e, tr, data] of world.query(Transform, Mesh)) {
          if (world.has(e, Model)) continue;
          indexedSeen.add(e);
          const look = world.get(e, Material),
            lookKey = look ? materialKey(look) : '';
          let m = indexed.get(e);
          if (!m) {
            // A Mesh has no texture coordinates: its Material shades it, but a texture is reported and not drawn.
            const surface = surfaces.create(look, data.color, {colors: data.colors.length > 0, uv: false});
            let mesh: T.Mesh<T.BufferGeometry, SurfaceMaterial>;
            try {
              mesh = new T.Mesh(indexedGeometry(data, resources), surface.material);
            } catch (error) {
              surface.dispose();
              throw error;
            }
            mesh.name = world.get(e, Name)?.name ?? `e${e}`;
            three.add(mesh);
            indexed.set(
              e,
              (m = {
                mesh,
                surface,
                positions: data.positions,
                indices: data.indices,
                colors: data.colors,
                normals: data.normals,
                revision: data.revision,
                sig: '',
              }),
            );
            dirty = true;
          } else if (
            m.positions !== data.positions ||
            m.indices !== data.indices ||
            m.colors !== data.colors ||
            m.normals !== data.normals ||
            m.revision !== data.revision
          ) {
            const current = replaceIndexedGeometry(
              m,
              data,
              resources,
              () => !actx.signal.aborted && indexed.get(e) === m,
              () => {
                dirty = true;
              },
            );
            if (actx.signal.aborted) return;
            if (!current || world.get(e, Mesh) !== data || world.get(e, Transform) !== tr || world.has(e, Model))
              continue;
          }
          const shade = scene.shadows ? shadowFlags(scene.shadows, world.get(e, Shadow)) : NO_SHADOW;
          const p = present(e, tr);
          const sig = `${p.x},${p.y},${p.z},${p.rx},${p.ry},${p.rz},${p.scale},${data.color},${data.visible},${maskOf(e)},${lookKey},${shade.cast},${shade.receive}`;
          if (m.sig !== sig) {
            if (m.surface && m.surface.key !== lookKey && !m.surface.update(look)) {
              // A Material added, removed, made invalid or given another shading class: one new surface.
              const previous = m.surface;
              m.surface = surfaces.create(look, data.color, {colors: data.colors.length > 0, uv: false});
              m.mesh.material = m.surface.material;
              previous.dispose();
              if (actx.signal.aborted) return;
            }
            m.mesh.position.set(p.x, p.y, p.z);
            m.mesh.rotation.set(p.rx, p.ry, p.rz);
            m.mesh.scale.setScalar(p.scale);
            m.mesh.material.color.setHex(data.color);
            m.mesh.visible = data.visible;
            m.mesh.layers.mask = maskOf(e);
            m.mesh.castShadow = shade.cast;
            m.mesh.receiveShadow = shade.receive;
            m.sig = sig;
            dirty = true;
          }
        }
        for (const [e, slot] of [...indexed])
          if (!indexedSeen.has(e) && indexed.get(e) === slot) {
            dirty = true;
            releaseIndexed(e, indexed, three, resources);
            if (actx.signal.aborted) return;
          }
        const cam = viewState.camera,
          key = `${cam.position},${cam.target},${cam.fov},${cam.minWidthFov},${cam.mask},${camera.aspect},${viewState.background}`;
        if (key !== lastCamera) {
          camera.layers.mask = validateRenderMask(cam.mask ?? 1);
          camera.position.set(...cam.position);
          camera.lookAt(...cam.target);
          const fov = effectiveFov(viewState);
          if (camera.fov !== fov) {
            camera.fov = fov;
            camera.updateProjectionMatrix();
          }
          if (!environment) three.background = new T.Color(viewState.background);
          syncListener();
          lastCamera = key;
          dirty = true;
        }
        if (viewState.environment) {
          if (!environment) {
            environment = bindEnvironment(three, sunShadowApply, skyLayer);
            for (const light of defaultLights) light.visible = false;
            dirty = true;
          }
          if (environment.sync(viewState.environment, camera)) dirty = true;
          if (!skyLoading && environment.wantsSky()) {
            skyLoading = true;
            void import('./scene-sky').then(
              m => {
                if (actx.signal.aborted) return;
                skyModule = m;
                environment?.refresh();
                dirty = true;
                actx.invalidate();
              },
              error => s.log.error(`${scene.id}: the sky could not load`, error),
            );
          }
          if (!scene.shadows && !sunShadowReported && viewState.environment.directional.shadow) {
            sunShadowReported = true;
            s.log.error(
              `${scene.id}: the environment's sun casts no shadow: the scene has no shadows (defineScene({ shadows: sceneShadows() }))`,
            );
          }
        } else if (environment) {
          environment.dispose();
          environment = null;
          for (const light of defaultLights) light.visible = true;
          three.background = new T.Color(viewState.background);
          dirty = true;
        }
        if (blobs) {
          // The sun's real shadow is live only in a scene with shadows, with a sun `shadow`, while the player's
          // `shadows.quality` is not `off` (no preset turns it off: its floor is `low`).
          const sun = sunCoverage({
            sceneShadows: !!sunShadow,
            extent: viewState.environment?.directional.shadow?.extent,
            quality: s.quality.knob('shadows.quality'),
          });
          if (blobs.sync({camera: viewState.camera.position, sun})) dirty = true;
        }
        if (output.sync(viewState.output)) dirty = true;
        if (
          cubes.sync(
            viewState.environment?.cube,
            viewState.environment?.reflection,
            viewState.environment?.background ?? viewState.background,
          )
        )
          dirty = true;
        if (post.sync(viewState.post, s.quality.knob('post.mode'))) dirty = true;
        for (const x of extensions)
          if (x.session)
            try {
              if (x.session.sync(dt)) dirty = true;
            } catch (error) {
              closeExtension(x, error);
            }
        if (lightRig) {
          lightSlots.sync(world);
          if (lightRig.apply(world, lightSlots, present)) dirty = true;
        } else if (world.version !== lastVersion && (world.first(PointLight) || world.first(SpotLight)))
          lightSlots.sync(world);
        if (world.version !== lastVersion) {
          lastVersion = world.version;
          dirty = true;
          if (!scene.scatter && !scatterReported && world.first(scatterProbe)) {
            scatterReported = true;
            s.log.error(
              `${scene.id}: a Scatter is not drawn: the scene has no scatter (defineScene({ scatter: sceneScatter() }))`,
            );
          }
          if (!scene.blobShadows && !blobsReported && world.first(blobProbe)) {
            blobsReported = true;
            s.log.error(
              `${scene.id}: a BlobShadow is not drawn: the scene has no blob shadows (defineScene({ blobShadows: sceneBlobShadows() }))`,
            );
          }
          if (!particles && !emittersReported && world.first(emitterProbe)) {
            emittersReported = true;
            s.log.error(
              `${scene.id}: an Emitter is not drawn: the scene has no particles (defineScene({ particles: sceneParticles() }))`,
            );
          }
        }
      };
      const resize = () => {
        if (actx.signal.aborted || actx.leaving()) return;
        const w = Math.max(1, view.clientWidth),
          h = Math.max(1, view.clientHeight);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        for (const x of extensions)
          try {
            x.session?.resized?.(w, h, renderer.getPixelRatio());
          } catch (error) {
            closeExtension(x, error);
          }
        dirty = true;
        actx.invalidate();
        sizes.refresh();
      };
      if (typeof ResizeObserver === 'function') {
        const ro = new ResizeObserver(resize);
        ro.observe(view);
        actx.own(() => ro.disconnect());
      }
      // Quality DPR updates clear the drawing buffer without changing the observed CSS box.
      const resizeWindow = doc.defaultView;
      resizeWindow?.addEventListener('resize', resize);
      actx.own(() => resizeWindow?.removeEventListener('resize', resize));
      resize();
      sync();

      const timing = TEST_API ? createSystemTiming(body.systems, visit, actx.signal) : undefined;
      let gpuTimer: GpuTimer | null = null;
      actx.own(() => {
        gpuTimer?.dispose();
        gpuTimer = null;
      });
      const fixedSystems = timing?.systems ?? body.systems;
      // The engine's particle step runs after the scene's own fixed systems, inside the replay tap's tick.
      const stepped = particles
        ? [...fixedSystems, {id: 'engine.particles', run: (_: SceneContext, dt: number) => particles.step(world, dt)}]
        : fixedSystems;
      const tapped = tap
        ? [
            {id: 'engine-tick-tap-begin', run: () => tap.beforeTick()},
            ...stepped,
            {id: 'engine-tick-tap-end', run: () => tap.afterTick()},
          ]
        : stepped;
      const runner = createSystemRunner(tapped, {
        step: FIXED_STEP,
        report: (id, error) => s.log.error(`${scene.id}: system ${id} failed`, error),
        after: () => world.clearEvents(),
        beforeStep: () => {
          pressed.beginStep();
          captureInterpolation(world);
        },
        beforeFrameLane: pressed.beginFrameLane,
      });
      alphaSource = () => runner.alpha;
      const live =
        body.systems.length > 0 || [...world.query(Model)].length > 0 || !!particles?.busy(world) || extensionsBusy();
      const handle: SceneHandle = {
        state: () => {
          const named: Record<string, {x: number; y: number; z: number}> = {};
          for (const [, n, tr] of world.query(Name, Transform))
            if (n.name) named[n.name] = {x: +tr.x.toFixed(3), y: +tr.y.toFixed(3), z: +tr.z.toFixed(3)};
          return {scene: scene.id, entities: world.count, state: captureResourceState(world.resources), named, frame};
        },
        teleport(x, z, name = 'player') {
          const e = ctx.named(name),
            tr = e === undefined ? undefined : world.get(e, Transform);
          if (!tr) return false;
          tr.x = x;
          tr.z = z;
          // A placement, not a move: draw it there at once rather than sliding (render interpolation).
          const interpolated = world.get(e!, Interpolated);
          if (interpolated) interpolated.revision++;
          world.touch();
          actx.invalidate();
          return true;
        },
      };
      if (TEST_API) handle.systemTrace = timing!.start;
      // Dev/test only: measured GPU time of this visit's draws (gpu-timer.ts). Off until asked; replaced on each call.
      if (TEST_API)
        handle.gpuTiming = (options = {}, onResult) => {
          if (actx.signal.aborted || actx.leaving()) return null;
          const next = createGpuTimer(renderer.getContext(), {
            ...options,
            onResult(frame, ms) {
              s.quality.gpuFrame(ms);
              onResult?.(frame, ms);
            },
          });
          gpuTimer?.dispose();
          gpuTimer = next;
          return next;
        };
      // Dev/test only: one real draw of the current picture, so play:snap can measure a still on-demand scene.
      if (TEST_API)
        handle.redraw = () => {
          if (actx.signal.aborted || actx.leaving()) return false;
          dirty = true;
          actx.invalidate();
          return true;
        };
      if (TEST_API)
        handle.model = createSceneModelInspector(
          request => models?.inspect?.(request) ?? inspectModel(request, () => null),
          visit,
          actx.signal,
        );
      if (TEST_API) handle.entities = createSceneEntityInspector(world, visit, actx.signal);
      if (TEST_API) handle.post = () => post.stats();
      if (TEST_API && extensions.length)
        handle.extensions = () =>
          Object.fromEntries(extensions.map(x => [x.id, x.session ? (x.session.stats?.() ?? {}) : {closed: true}]));
      if (TEST_API) handle.lights = () => structuredClone(lightSlots.stats);
      if (TEST_API && particles)
        handle.particles = () => ({
          ...particles.stats,
          draws: particleView.stats.visible,
          textures: {
            requested: particleView.stats.requested,
            leases: particleView.stats.leases,
            applied: particleView.stats.applied,
            failed: particleView.stats.failed,
          },
        });
      if (TEST_API && scene.blobShadows) handle.blobShadows = () => (blobs ? {...blobs.stats} : null);
      if (TEST_API && scene.scatter)
        handle.scatter = () => {
          const st = scatter?.stats;
          return st ? {...st, refused: {...st.refused}, list: st.list.map(entry => ({...entry}))} : null;
        };
      s.play.attach(handle, actx.signal);

      // Prepare authored resident materials before router activation/first render.
      // Async asset replacements still own their later preparation; this is not a GPU upload/shadow guarantee.
      let programsPrepared = false,
        preparationVersion = 0;
      let programFailed = false;
      // Systems start only once initial preparation settles and the visit has arrived: the router's first-render
      // frames draw the spawned entities, but no system steps until `enter()` has set up the visit's state.
      let simulating = false;
      const failPrograms = (error: ProgramLinkError | FrameReadinessError) => {
        if (programFailed || actx.leaving() || actx.signal.aborted) return;
        programFailed = true;
        programsPrepared = false;
        view.dataset.programReadiness = 'failed';
        const card = doc.createElement('div');
        card.className = 'scene-failure-card';
        card.setAttribute('role', 'alert');
        const message = doc.createElement('p');
        message.textContent = failureText('engine.scene-loading.could-not-open', {scene: scene.id});
        const retry = doc.createElement('button');
        retry.type = 'button';
        retry.textContent = failureText('engine.scene-loading.try-again');
        retry.addEventListener(
          'click',
          () => {
            if (actx.signal.aborted || actx.leaving()) return;
            void s.router.reenter('graphics').catch(reason => {
              try {
                s.log.error('Shader recovery failed', reason);
              } catch {
                /* Isolated diagnostic. */
              }
            });
          },
          {signal: actx.signal},
        );
        card.append(message, retry);
        view.append(card);
        actx.own(() => card.remove());
        const failureLayer: LayerSpec = {
          id: `${actx.runId}:program-failure`,
          kind: 'modal',
          element: card,
          cover: 'opaque',
          modal: 'scope',
          initialFocus: () => retry,
          onEscape: () => false,
        };
        actx.layer(failureLayer);
        try {
          s.log.error(`${scene.id}: shader link failed`, error);
        } catch {
          /* Isolated diagnostic. */
        }
      };
      const preparePrograms = () => {
        const version = ++preparationVersion;
        programsPrepared = false;
        view.dataset.programReadiness = 'preparing';
        if (actx.leaving() || actx.signal.aborted) throw Error('Scene program preparation retired');
        sync();
        renderer.compile(three, camera);
        post.compile(three, camera);
        const programs = (surface.programsReady?.(actx.signal) ?? Promise.resolve('unsupported')).catch(error => {
          if (
            error instanceof ProgramLinkError ||
            version !== preparationVersion ||
            actx.leaving() ||
            actx.signal.aborted ||
            renderer.getContext().isContextLost()
          )
            throw error;
          // Capacity, timeout or a driver query failure is not a link verdict: degrade to the
          // pre-existing first-draw compilation (which still validates links) instead of refusing the scene.
          try {
            s.log.error(`${scene.id}: program preparation unavailable; first-render compilation fallback`, error);
          } catch {
            /* Isolated diagnostic. */
          }
          return 'degraded' as const;
        });
        return programs.then(async result => {
          if (version !== preparationVersion || result === 'retired' || actx.leaving() || actx.signal.aborted)
            throw Error('Scene program preparation retired');
          // A scene with post waits (bounded) for its chunk, so its first picture is already the composed one.
          await post.settled(POST_WAIT_MS);
          if (version !== preparationVersion || actx.leaving() || actx.signal.aborted)
            throw Error('Scene program preparation retired');
          sync();
          post.compile(three, camera);
          // Include a real initial draw: generated passes can create programs absent from compile().
          if (!drawOverride() && !post.render(three, camera)) renderer.render(three, camera);
          const frame = await (surface.frameReady?.(actx.signal) ?? Promise.resolve('ready'));
          if (frame === 'retired') throw Error('Scene frame preparation retired');
          if (version !== preparationVersion || actx.leaving() || actx.signal.aborted)
            throw Error('Scene program preparation retired');
          view.dataset.programReadiness = result;
          programsPrepared = true;
          simulating = true;
          actx.invalidate();
        });
      };
      const ready = preparePrograms();
      return {
        ready,
        frameMode: live ? 'continuous' : 'on-demand',
        update(f: FrameInfo) {
          if (programFailed) return;
          if (!simulating || !arrived) {
            pressed.clear();
            gestures.pointer.pressed = false;
            return;
          }
          try {
            frame++;
            t += f.dt;
            calm = f.calm;
            frameMs = f.t * 1000;
            gestures.sync();
            // A held replay tap runs no tick: release live presses so none surfaces at replay tick 0.
            let steps = 0;
            if (!tap || tap.running()) steps = runner.frame(ctx, f.dt);
            else pressed.clear();
            pressed.endFrame();
            gestures.pointer.pressed = false;
            sync(f.dt);
            // Drawn at the latest fixed step, like Shape meshes (sync above), so particles never trail a non-interpolated emitter (an `Interpolated` emitter is drawn up to one step behind them).
            // Written only in a frame where a fixed step ran (60 Hz: on a 120/144 Hz display other frames redraw nothing
            // for particles) and while particles are (or were just) live.
            if (steps > 0 && particles?.interpolate(1)) dirty = true;
          } catch (error) {
            if (error instanceof ProgramLinkError || error instanceof FrameReadinessError) failPrograms(error);
            else throw error;
          }
        },
        render(f: FrameInfo) {
          if (programFailed) return false;
          try {
            sync();
            if (actx.leaving() || actx.signal.aborted || !programsPrepared || !dirty) return false;
            // Off (production, and dev/test until asked): one null check. On: the draw is wrapped in one query.
            let timed = false;
            if (gpuTimer) {
              if (gpuTimer.status === 'disposed') gpuTimer = null;
              else {
                gpuTimer.poll();
                timed = gpuTimer.begin(f.frame);
              }
            }
            try {
              if (!drawOverride() && !post.render(three, camera)) renderer.render(three, camera);
            } finally {
              if (timed) gpuTimer?.end();
            }
          } catch (error) {
            if (!(error instanceof ProgramLinkError || error instanceof FrameReadinessError)) throw error;
            failPrograms(error);
            return false;
          }
          dirty = false;
          if (!actx.leaving() && !actx.signal.aborted && visit.current()) {
            try {
              scene.rendered?.(ctx);
            } catch (error) {
              try {
                s.log.error(`${scene.id}: rendered hook failed`, error);
              } catch {
                /* Reporting cannot disrupt frame cleanup. */
              }
            }
          }
          return true;
        },
        activate() {
          sceneLayer.activate();
          view.focus({preventScroll: true});
          syncListener();
        },
        leave() {
          activityEvents?.retire();
          scene.exit?.(ctx);
        },
        contextRestored() {
          dirty = true;
          gpuTimer?.contextRestored();
          let pending: Promise<void>;
          try {
            pending = preparePrograms();
          } catch (error) {
            pending = Promise.reject(error);
          }
          const version = preparationVersion;
          void pending.catch(error => {
            if (
              version !== preparationVersion ||
              actx.leaving() ||
              actx.signal.aborted ||
              renderer.getContext().isContextLost()
            )
              return;
            if (error instanceof ProgramLinkError || error instanceof FrameReadinessError) {
              failPrograms(error);
              return;
            }
            // Recovery retains the original synchronous render fallback, visibly distinct from readiness.
            view.dataset.programReadiness = 'degraded';
            programsPrepared = true;
            actx.invalidate();
            try {
              s.log.error(`${scene.id}: program preparation failed; first-render compilation fallback`, error);
            } catch {
              /* Isolated diagnostic. */
            }
          });
        },
      };
    },
  };
  return enterActivity({
    host: s.shell.activities,
    mount: s.shell.mount,
    activity,
    visit,
    arrive: () => {
      if (ctxRef) {
        try {
          scene.enter?.(ctxRef);
        } finally {
          arrived = true;
        }
        activityStart?.();
        tapArrive?.();
      }
    },
  });
}
