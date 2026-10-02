import {FrameReadinessError} from '../platform/render/frame-readiness';
import {ProgramLinkError} from '../platform/render/program-validation';
import {t as failureText} from '../core/i18n/app-i18n';
import { createSceneActivity } from './scene-activity';
import { normalizeModelPoseLinkLimits } from './model-pose-link';
import { createSceneModelInspector } from './model-inspection';
import { authorSaveHandle } from './save-handle';
import { createViewSize } from './view-size';
import { createReadingSheets } from './reading-sheet';
import { bindSceneCubes } from './scene-cubes';
import { Model } from './model';
import { createSceneModels } from './scene-model';
import { RenderMask, validateRenderMask } from './render-mask';
import { bindEnvironment } from './scene-environment';
/**
 * author/runtime.ts: a scene's lazy body, loaded the first time a scene is entered (never in the first-load bundle).
 *
 * One visit of a scene is one activity run (ADR 0032) on the scene shell's host:
 *  - a world (core/ecs) spawned from the scene's entities; its systems run on the one frame loop, `fixed` systems at
 *    a fixed 60 Hz step and `frame` systems once per frame (core/ecs/systems.ts);
 *  - input: each game action is subscribed for the visit; systems read `pressed`, `held`, `axis` and the pointer;
 *  - drawing: entities with `Transform` and `Shape` become meshes on the pooled world surface. A frame is drawn only
 *    when something changed (a transform, a shape, the camera, the world's version): render on change (STD-RUN-9);
 *  - `enter` runs once the visit is active (ADR 0045); `exit` when it is left. Everything the visit creates is owned
 *    by the run and released in reverse order when it leaves.
 */
import * as T from 'three';
import type { Services } from '../core/services';
import type { SceneRun, SceneVisit } from '../core/router/handover';
import type { ActivityContext, ActivityRun } from '../core/activity/activity';
import type { FrameInfo } from '../core/activity/loop';
import { World, type Entity } from '../core/ecs/world';
import { createSystemRunner } from '../core/ecs/systems';
import { createRng } from '../core/rng';
import { appI18n } from '../core/i18n/app-i18n';
import { runRandom } from '../core/run-random';
import { appRenderers } from '../platform/render/renderer-pool';
import { disposeOwnedTree } from '../platform/render/dispose-owned-tree';
import { enterActivity, type SceneParams } from '../platform/ui/scene-shell';
import type { BuildBrief } from './build';
import type { SceneHandle } from './play';
import { TEST_API } from '../core/env';
import { createSystemTiming } from './system-timing';
import { openSceneTickTap, type SceneTickTap } from './scene-tick-tap';
import { createSceneEntityInspector } from './entity-inspection';
import { actionOf, sceneId } from './ids';
import { bodyOf, spawnInto } from './body';
import { effectiveFov } from './view-math';
import { Mesh } from './mesh';
import { createSceneResources } from './scene-resources';
import { retireRepresentations } from './representation-cleanup';
import { indexedGeometry, replaceIndexedGeometry, releaseIndexed, type IndexedSlot } from './indexed-geometry';
import { createPrimitiveGeometries, type PrimitiveGeometryLease } from './primitive-geometries';
import {createSceneVoices} from './scene-audio';
import {sceneInput} from './scene-input';
import {appLayers} from '../platform/ui/runtime';
import { sceneActionHints } from './action-hints';
import { bindScenePointer } from './scene-pointer';
import { createPressLatch } from './press-latch';
import type { LayerHandle, LayerSpec } from '../platform/ui/layers';
import { viewOwnsInput } from '../platform/input/owner';
import { Name, Shape, Transform, type InputDefinition, type SceneContext, type SceneDefinition, type ViewState } from './defs';

/** The fixed lane's step (core/ecs/systems.ts default), named so a replay header can record it. */
const FIXED_STEP = 1 / 60;
const seedFromAddress = (): number | null => {
  if (typeof location === 'undefined') return null;
  const s = new URLSearchParams(location.search).get('seed');
  return s !== null && /^\d+$/.test(s) ? Number(s) : null;
};

const json = (v: unknown): Record<string, unknown> => { try { return JSON.parse(JSON.stringify(v ?? {})) as Record<string, unknown>; } catch { return {}; } };

const preparations = new WeakMap<SceneVisit,{body: Awaited<ReturnType<typeof bodyOf>>; state:Record<string,unknown>}>();
/** CPU/data preflight cannot allocate a second render surface or issue gameplay input. */
export async function prepareScene(s:Services,scene:SceneDefinition,visit:SceneVisit):Promise<void>{
  const body=await bodyOf(scene),state:Record<string,unknown>={};
  if(visit.signal.aborted)return;
  await scene.prepare?.({state,text:(key,vars)=>(appI18n.t as (k:string,v?:unknown)=>string)(key,vars),service:key=>s[key]},visit.signal);
  if(!visit.signal.aborted)preparations.set(visit,{body,state});
}

export async function enterScene(o: { s: Services; brief: BuildBrief; scene: SceneDefinition; visit: SceneVisit; inputs: readonly InputDefinition[] }): Promise<SceneRun> {
  const { s, brief, scene, visit } = o;
  const prepared=preparations.get(visit);
  const body = prepared?.body ?? await bodyOf(scene);
  preparations.delete(visit);
  let ctxRef: SceneContext | null = null;
  let activityStart: (() => void) | undefined;
  let tapArrive: (() => void) | undefined;
  const activity = {
    id: sceneId(scene.id), kind: 'scene' as const,
    enter(actx: ActivityContext, { mount }: SceneParams): ActivityRun {
      const doc = mount.ownerDocument;
      const view = doc.createElement('div');
      view.className = 'scene-view'; view.setAttribute('data-scene', scene.id); view.tabIndex = 0;
      const overlay = doc.createElement('div'); overlay.className = 'scene-overlay';
      mount.append(view); view.append(overlay);
      actx.own(() => view.remove());
      const sceneLayerSpec:LayerSpec={id:actx.runId,kind:'scene',element:view,cover:'opaque',modal:false,dormant:true};
      const sceneLayer=actx.layer(sceneLayerSpec) as LayerHandle;
      const surface = appRenderers().lease({ role: 'world', host: view, insert: 'prepend', ctx: actx, profile: { clearColor: scene.view?.background ?? 0x101820, outputColorSpace: T.SRGBColorSpace } });
      if (!surface) throw Error(`${scene.id}: WebGL could not start`);
      const renderer = surface.renderer;

      const three = new T.Scene();
      actx.own(() => disposeOwnedTree(three));
      const defaultLights: T.Light[] = [];
      if ((scene.view?.lights ?? 'default') === 'default') {
        const ambient = new T.HemisphereLight(0xffffff, 0x445566, 1.6);
        const sun = new T.DirectionalLight(0xffffff, 1.4); sun.position.set(4, 9, 6);
        defaultLights.push(ambient, sun); three.add(ambient, sun);
        for (const light of defaultLights) light.visible = !scene.view?.environment;
      }
      const camera = new T.PerspectiveCamera(scene.view?.camera?.fov ?? 50, 1, 0.1, 500);
      const sizes = createViewSize(actx.signal, () => ({ width: Math.max(1, view.clientWidth), height: Math.max(1, view.clientHeight) }), error => s.log.error(`${scene.id}: viewport observer failed`, error));
      const viewState: ViewState = {
        observeSize: sizes.observe,
        camera: { position: [...scene.view?.camera?.position ?? [0, 8, 10]], target: [...scene.view?.camera?.target ?? [0, 0, 0]], fov: scene.view?.camera?.fov ?? 50, mask: scene.view?.camera?.mask ?? 1, ...(scene.view?.camera?.minWidthFov ? { minWidthFov: scene.view.camera.minWidthFov } : {}) },
        background: scene.view?.background ?? 0x101820, environment: scene.view?.environment, overlay,
        openReadingSheet: options => readingSheets.open(options),
        get aspect() { return camera.aspect; },
      };

      let environment = scene.view?.environment ? bindEnvironment(three) : null;
      actx.own(() => environment?.dispose());
      const cubes=bindSceneCubes(three,s.assets,actx.signal,()=>{dirty=true;actx.invalidate();},error=>s.log.error(`${scene.id}: background failed`,error));
      actx.own(()=>cubes.dispose());

      // The world and its entities.
      const world = new World();
      if(prepared)Object.assign(world.resources,prepared.state);
      for (const e of body.entities) spawnInto(world, e);

      // Input: every game action is owned by this visit; a press is kept for the frame that reads it and, across
      // zero-step frames, for the next fixed tick (press-latch.ts, STD-SIM-12).
      const pressed = createPressLatch(), input = s.input;
      for (const i of o.inputs) {
        if (i.axis) for (const side of ['negative', 'positive'] as const) input.onAction(actionOf(i.id, side), () => { actx.invalidate(); return true; }, { owner: actx.runId, signal: actx.signal });
        else input.onAction(actionOf(i.id), e => { if (e.phase === 'press') { pressed.add(i.id); actx.invalidate(); } return true; }, { owner: actx.runId, signal: actx.signal });
      }
      const ownsInput = () => !actx.signal.aborted && actx.coverage() === 'top' && viewOwnsInput(view) && !view.closest('.view-covered');
      const gestures = bindScenePointer(surface.canvas, {
        signal: actx.signal,
        owns: ownsInput,
        press: () => { pressed.pointerPressed(); for (const i of o.inputs) if (i.tap) pressed.add(i.id); },
        canceled: () => pressed.clear(), blocked: () => input.cancel('overlay'), invalidate: () => actx.invalidate(),
      });
      const pointer = pressed.pointer(gestures.pointer);
      input.onCancel(() => gestures.cancel(), actx.signal);
      actx.own(() => gestures.dispose());
      const readingSheets = createReadingSheets(actx, overlay, {
        canOpen: ownsInput,
        cancelInput: () => { pressed.clear(); gestures.cancel(); input.cancel('overlay'); },
      });
      actx.own(() => readingSheets.dispose());

      const seed = seedFromAddress();
      const rng = seed === null ? null : createRng(seed);
      const random = () => (rng ?? runRandom.stream(`scene.${scene.id}`)).next();
      const liveInput = sceneInput(ownsInput, id => input.held(id), pressed, pointer, sceneActionHints(o.inputs, id => input.describeAction(id)));
      // Dev/test only: a replay tool may record or drive this visit's fixed ticks (scene-tick-tap.ts).
      let tap: SceneTickTap | null = null;
      if (TEST_API) {
        try {
          tap = openSceneTickTap({ scene: scene.id, game: { id: s.play.game.id, version: s.play.game.version }, inputs: o.inputs.map(i => ({ id: i.id, axis: !!i.axis })),
            seed, step: FIXED_STEP, world, live: liveInput, invalidate: () => actx.invalidate() });
        } catch (error) { s.log.error(`${scene.id}: tick tap failed`, error); }
        if (tap) { const owned = tap; actx.own(() => owned.retire()); tapArrive = () => owned.arrive(); }
      }
      let frame = 0, t = 0, calm = false;
      const voices = createSceneVoices((cue, options) => !s.app.has('platform.audio') || actx.signal.aborted ? null : s.audio.playVoice(cue, options));
      actx.own(() => voices.dispose());
      const ctx: SceneContext = {
        world, state: world.resources, brief,
        scene: {
          id: scene.id, params: visit.params,
          goto: (id, params) => { void s.router.go(sceneId(id), params ? { params } : {}); },
          restart: () => { void s.router.go(sceneId(scene.id), { params: { ...visit.params }, again: 'reenter' }); },
        },
        input: tap ? tap.input : liveInput,
        get time() { return { t, frame, calm }; },
        view: viewState,
        spawn: (prefab, ...extra) => spawnInto(world, prefab, extra),
        named: name => { for (const [e, n] of world.query(Name)) if (n.name === name) return e; return undefined; },
        save: def => authorSaveHandle(s.save, def),
        text: (key, vars) => (appI18n.t as (k: string, v?: unknown) => string)(key, vars),
        play: cue => { voices.play(cue); },
        playVoice: (cue, options) => voices.play(cue, options),
        modelState: entity => models.state(entity),
        modelAttachmentState: entity => models.attachmentState(entity),
        modelPoseLinkState: entity => models.poseLinkState(entity),
        modelSocket: (entity, name) => models.socket(entity, name),
        random,
        service: key => s[key],
      };
      ctxRef = ctx;
      const activityEvents = scene.activity ? createSceneActivity(
        () => ({ phase: actx.leaving() || visit.signal.aborted ? 'retired' : 'active', coverage: actx.coverage(), documentHidden: doc.hidden }),
        facts => scene.activity!(ctx, facts), error => s.log.error(`${scene.id}: activity hook failed`, error),
        () => actx.leave('error'),
      ) : undefined;
      if (activityEvents) {
        const refresh = () => {
          if (actx.leaving() || visit.signal.aborted) activityEvents.retire(); else activityEvents.refresh();
        };
        actx.own(appLayers(doc).onChange(refresh));
        doc.addEventListener('visibilitychange', refresh);
        actx.own(() => doc.removeEventListener('visibilitychange', refresh));
        activityStart = () => { if (!actx.leaving() && visit.current()) activityEvents.start(); };
        actx.own(() => activityEvents.retire());
      }

      // Drawing: meshes follow Transform + Shape; draw only when something changed.
      const resources = createSceneResources();
      const geometries = createPrimitiveGeometries(resources);
      const meshes = new Map<Entity, { mesh: T.Mesh; geometry: PrimitiveGeometryLease; sig: string }>();
      // Indexed meshes own their geometry/material individually; detach before general tree cleanup.
      const indexed = new Map<Entity, IndexedSlot>();
      actx.own(() => {
        const indexedMeshes = [...indexed.values()], primitiveMeshes = [...meshes.values()];
        indexed.clear(); meshes.clear();
        retireRepresentations(three, [...indexedMeshes, ...primitiveMeshes].map(({ mesh }) => mesh),
          [() => geometries.dispose(), () => resources.dispose()]);
      });
      let lastCamera = '', lastVersion = -1, dirty = true;
      const syncListener = () => {
        if (actx.signal.aborted || !s.app.has('platform.audio') || actx.coverage() !== 'top') return;
        const forward = new T.Vector3(); camera.getWorldDirection(forward);
        const up = new T.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        s.audio.setListener(camera.position.toArray() as [number,number,number], forward.toArray() as [number,number,number], up.toArray() as [number,number,number]);
      };
      actx.own(appLayers(doc).onChange(() => { syncListener(); gestures.sync(); }));
      const maskOf = (e: Entity) => validateRenderMask(world.get(e, RenderMask)?.mask ?? 1);
      const models = createSceneModels({ poseLinks: scene.modelPoseLinks === undefined ? undefined : normalizeModelPoseLinkLimits(scene.modelPoseLinks), inspection: TEST_API,world, scene: three, library: s.models, signal: actx.signal,
        mask: maskOf, invalidate: () => { dirty = true; actx.invalidate(); }, report: error => s.log.error(`${scene.id}: model failed`, error)});
      actx.own(() => models.dispose());
      const sync = (dt = 0) => {
        if (actx.signal.aborted) return;
        actx.setFrameMode(body.systems.length || [...world.query(Model)].some(([,m])=>m.playing && !!m.clip && m.speed>0) ? 'continuous' : 'on-demand');
        if (models.sync(dt)) dirty = true;
        const seen = new Set<Entity>();
        for (const [e, tr, sh] of world.query(Transform, Shape)) {
          if (world.has(e, Mesh) || world.has(e, Model)) continue; // Deterministic precedence; never draw two representations.
          seen.add(e);
          const sig = `${tr.x},${tr.y},${tr.z},${tr.rx},${tr.ry},${tr.rz},${tr.scale},${sh.kind},${sh.size},${sh.color},${sh.visible},${maskOf(e)}`;
          let m = meshes.get(e);
          if (!m) {
            const geometry = geometries.acquire(sh.kind, sh.size);
            let material: T.MeshLambertMaterial | undefined;
            let mesh: T.Mesh | undefined;
            try {
              material = resources.own(new T.MeshLambertMaterial({ color: sh.color }));
              mesh = new T.Mesh(geometry.geometry, material);
              mesh.name = world.get(e, Name)?.name ?? `e${e}`;
              three.add(mesh); meshes.set(e, m = { mesh, geometry, sig: '' });
            } catch (error) {
              const errors = [error];
              try { if (mesh) three.remove(mesh); } catch (cleanup) { errors.push(cleanup); }
              try { geometry.release(); } catch (cleanup) { errors.push(cleanup); }
              try { if (material) resources.release(material); } catch (cleanup) { errors.push(cleanup); }
              if (errors.length > 1) throw new AggregateError(errors, 'primitive construction failed');
              throw error;
            }
          }
          if (m.sig === sig) continue;
          const { mesh } = m;
          if (m.geometry.key !== `${sh.kind}:${sh.size}`) {
            const replacement = geometries.acquire(sh.kind, sh.size);
            const previous = m.geometry;
            mesh.geometry = replacement.geometry; m.geometry = replacement; dirty = true;
            previous.release();
            if (actx.signal.aborted) return;
            if (meshes.get(e) !== m || m.geometry !== replacement) continue;
          }
          mesh.position.set(tr.x, tr.y, tr.z); mesh.rotation.set(tr.rx, tr.ry, tr.rz); mesh.scale.setScalar(tr.scale);
          (mesh.material as T.MeshLambertMaterial).color.setHex(sh.color); mesh.visible = sh.visible; mesh.layers.mask = maskOf(e);
          m.sig = sig; dirty = true;
        }
        for (const [e, m] of [...meshes]) if (!seen.has(e) && meshes.get(e) === m) {
          meshes.delete(e); dirty = true;
          const geometry = m.geometry, material = m.mesh.material as T.Material;
          retireRepresentations(three, [m.mesh], [() => geometry.release(), () => resources.release(material)]);
          if (actx.signal.aborted) return;
        }
        const indexedSeen = new Set<Entity>();
        for (const [e, tr, data] of world.query(Transform, Mesh)) {
          if (world.has(e, Model)) continue;
          indexedSeen.add(e);
          let m = indexed.get(e);
          if (!m) {
            const mesh = new T.Mesh(indexedGeometry(data, resources), resources.own(new T.MeshLambertMaterial({ color: data.color, vertexColors: data.colors.length > 0 })));
            mesh.name = world.get(e, Name)?.name ?? `e${e}`;
            three.add(mesh);
            indexed.set(e, m = { mesh, positions: data.positions, indices: data.indices, colors: data.colors, normals: data.normals, revision: data.revision, sig: '' });
            dirty = true;
          } else if (m.positions !== data.positions || m.indices !== data.indices || m.colors !== data.colors || m.normals !== data.normals || m.revision !== data.revision) {
            const current = replaceIndexedGeometry(m, data, resources,
              () => !actx.signal.aborted && indexed.get(e) === m,
              () => { dirty = true; });
            if (actx.signal.aborted) return;
            if (!current || world.get(e, Mesh) !== data || world.get(e, Transform) !== tr || world.has(e, Model)) continue;
          }
          const sig = `${tr.x},${tr.y},${tr.z},${tr.rx},${tr.ry},${tr.rz},${tr.scale},${data.color},${data.visible},${maskOf(e)}`;
          if (m.sig !== sig) {
            m.mesh.position.set(tr.x, tr.y, tr.z); m.mesh.rotation.set(tr.rx, tr.ry, tr.rz); m.mesh.scale.setScalar(tr.scale);
            m.mesh.material.color.setHex(data.color); m.mesh.visible = data.visible; m.mesh.layers.mask = maskOf(e);
            m.sig = sig; dirty = true;
          }
        }
        for (const [e, slot] of [...indexed]) if (!indexedSeen.has(e) && indexed.get(e) === slot) {
          dirty = true;
          releaseIndexed(e, indexed, three, resources);
          if (actx.signal.aborted) return;
        }
        const cam = viewState.camera, key = `${cam.position},${cam.target},${cam.fov},${cam.minWidthFov},${cam.mask},${camera.aspect},${viewState.background}`;
        if (key !== lastCamera) {
          camera.layers.mask = validateRenderMask(cam.mask ?? 1);
          camera.position.set(...cam.position); camera.lookAt(...cam.target);
          const fov = effectiveFov(viewState);
          if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
          if (!environment) three.background = new T.Color(viewState.background);
          syncListener();
          lastCamera = key; dirty = true;
        }
        if (viewState.environment) {
          if (!environment) { environment = bindEnvironment(three); for (const light of defaultLights) light.visible = false; dirty = true; }
          if (environment.sync(viewState.environment, camera)) dirty = true;
        } else if (environment) {
          environment.dispose(); environment = null; for (const light of defaultLights) light.visible = true;
          three.background = new T.Color(viewState.background); dirty = true;
        }
        if (cubes.sync(viewState.environment?.cube, viewState.environment?.reflection, viewState.environment?.background ?? viewState.background)) dirty = true;
        if (world.version !== lastVersion) { lastVersion = world.version; dirty = true; }
      };
      const resize = () => {
        const w = Math.max(1, view.clientWidth), h = Math.max(1, view.clientHeight);
        renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true; actx.invalidate();
        sizes.refresh();
      };
      if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(resize); ro.observe(view); actx.own(() => ro.disconnect()); }
      resize();
      sync();

      const timing = TEST_API ? createSystemTiming(body.systems, visit, actx.signal) : undefined;
      const fixedSystems = timing?.systems ?? body.systems;
      const tapped = tap ? [{ id: 'engine-tick-tap-begin', run: () => tap.beforeTick() }, ...fixedSystems, { id: 'engine-tick-tap-end', run: () => tap.afterTick() }] : fixedSystems;
      const runner = createSystemRunner(tapped, { step: FIXED_STEP, report: (id, error) => s.log.error(`${scene.id}: system ${id} failed`, error), after: () => world.clearEvents(), beforeStep: pressed.beginStep, beforeFrameLane: pressed.beginFrameLane });
      const live = body.systems.length > 0 || [...world.query(Model)].length > 0;
      const handle: SceneHandle = {
        state: () => {
          const named: Record<string, { x: number; y: number; z: number }> = {};
          for (const [, n, tr] of world.query(Name, Transform)) if (n.name) named[n.name] = { x: +tr.x.toFixed(3), y: +tr.y.toFixed(3), z: +tr.z.toFixed(3) };
          return { scene: scene.id, entities: world.count, state: json(world.resources), named, frame };
        },
        teleport(x, z, name = 'player') {
          const e = ctx.named(name), tr = e === undefined ? undefined : world.get(e, Transform);
          if (!tr) return false;
          tr.x = x; tr.z = z; world.touch(); actx.invalidate(); return true;
        },
      };
      if (TEST_API) handle.systemTrace = timing!.start;
      if (TEST_API && models.inspect) handle.model = createSceneModelInspector(models.inspect, visit, actx.signal);
      if (TEST_API) handle.entities = createSceneEntityInspector(world, visit, actx.signal);
      s.play.attach(handle, actx.signal);

      // Prepare authored resident materials before router activation/first render.
      // Async asset replacements still own their later preparation; this is not a GPU upload/shadow guarantee.
      let programsPrepared=false,preparationVersion=0;
      let programFailed=false;
      // Systems start only once initial preparation settles, as before this preparation existed:
      // the router's first-render frames then precede arrival, so systems never run long before enter().
      let simulating=false;
      const failPrograms=(error:ProgramLinkError|FrameReadinessError)=>{
        if(programFailed||actx.leaving()||actx.signal.aborted)return;
        programFailed=true;programsPrepared=false;view.dataset.programReadiness='failed';
        const card=doc.createElement('div');card.className='scene-failure-card';card.setAttribute('role','alert');
        const message=doc.createElement('p');message.textContent=failureText('engine.scene-loading.could-not-open',{scene:scene.id});
        const retry=doc.createElement('button');retry.type='button';retry.textContent=failureText('engine.scene-loading.try-again');
        retry.addEventListener('click',()=>{
          if(actx.signal.aborted||actx.leaving())return;
          void s.router.reenter('graphics').catch(reason=>{try{s.log.error('Shader recovery failed',reason);}catch{/* Isolated diagnostic. */}});
        },{signal:actx.signal});
        card.append(message,retry);view.append(card);actx.own(()=>card.remove());
        const failureLayer:LayerSpec={id:`${actx.runId}:program-failure`,kind:'modal',element:card,cover:'opaque',modal:'scope',initialFocus:()=>retry,onEscape:()=>false};
        actx.layer(failureLayer);
        try{s.log.error(`${scene.id}: shader link failed`,error);}catch{/* Isolated diagnostic. */}
      };
      const preparePrograms=()=>{
        const version=++preparationVersion;
        programsPrepared=false;view.dataset.programReadiness='preparing';
        if(actx.leaving()||actx.signal.aborted)throw Error('Scene program preparation retired');
        sync();renderer.compile(three,camera);
        const programs=(surface.programsReady?.(actx.signal)??Promise.resolve('unsupported')).catch(error=>{
          if(error instanceof ProgramLinkError||version!==preparationVersion||actx.leaving()||actx.signal.aborted||renderer.getContext().isContextLost())throw error;
          // Capacity, timeout or a driver query failure is not a link verdict: degrade to the
          // pre-existing first-draw compilation (which still validates links) instead of refusing the scene.
          try{s.log.error(`${scene.id}: program preparation unavailable; first-render compilation fallback`,error);}catch{/* Isolated diagnostic. */}
          return 'degraded' as const;
        });
        return programs.then(async result=>{
          if(version!==preparationVersion||result==='retired'||actx.leaving()||actx.signal.aborted)throw Error('Scene program preparation retired');
          // Include a real initial draw: generated passes can create programs absent from compile().
          renderer.render(three,camera);
          const frame=await(surface.frameReady?.(actx.signal)??Promise.resolve('ready'));
          if(frame==='retired')throw Error('Scene frame preparation retired');
          if(version!==preparationVersion||actx.leaving()||actx.signal.aborted)throw Error('Scene program preparation retired');
          view.dataset.programReadiness=result;programsPrepared=true;simulating=true;actx.invalidate();
        });
      };
      const ready=preparePrograms();
      return {
        ready,
        frameMode: live ? 'continuous' : 'on-demand',
        update(f: FrameInfo) {
          if(programFailed)return;
          if(!simulating){pressed.clear();gestures.pointer.pressed=false;return;}
          try{
          frame++; t += f.dt; calm = f.calm;
          gestures.sync();
          // A held replay tap runs no tick: release live presses so none surfaces at replay tick 0.
          if (!tap || tap.running()) runner.frame(ctx, f.dt); else pressed.clear();
          pressed.endFrame(); gestures.pointer.pressed = false;
          sync(f.dt);
          }catch(error){if(error instanceof ProgramLinkError||error instanceof FrameReadinessError)failPrograms(error);else throw error;}
        },
        render() {
          if(programFailed)return false;
          try{
            sync(); if (actx.leaving() || actx.signal.aborted || !programsPrepared || !dirty) return false;
            renderer.render(three,camera);
          }catch(error){
            if(!(error instanceof ProgramLinkError||error instanceof FrameReadinessError))throw error;
            failPrograms(error);return false;
          }
          dirty = false;
          if (!actx.leaving() && !actx.signal.aborted && visit.current()) {
            try { scene.rendered?.(ctx); }
            catch (error) {
              try { s.log.error(`${scene.id}: rendered hook failed`, error); } catch { /* Reporting cannot disrupt frame cleanup. */ }
            }
          }
          return true;
        },
        activate() { sceneLayer.activate(); view.focus({ preventScroll: true }); syncListener(); },
        leave() { activityEvents?.retire(); scene.exit?.(ctx); },
        contextRestored() {
          dirty=true;
          let pending:Promise<void>;try{pending=preparePrograms();}catch(error){pending=Promise.reject(error);}
          const version=preparationVersion;
          void pending.catch(error=>{
            if(version!==preparationVersion||actx.leaving()||actx.signal.aborted||renderer.getContext().isContextLost())return;
            if(error instanceof ProgramLinkError||error instanceof FrameReadinessError){failPrograms(error);return;}
            // Recovery retains the original synchronous render fallback, visibly distinct from readiness.
            view.dataset.programReadiness='degraded';programsPrepared=true;actx.invalidate();
            try{s.log.error(`${scene.id}: program preparation failed; first-render compilation fallback`,error);}catch{/* Isolated diagnostic. */}
          });
        },
      };
    },
  };
  return enterActivity({
    host: s.shell.activities, mount: s.shell.mount, activity, visit,
    arrive: () => { if (ctxRef) { scene.enter?.(ctxRef); activityStart?.(); tapArrive?.(); } },
  });
}
