import { createSceneActivity } from './scene-activity';
import type { SceneActivityFacts } from './defs';
import { ModelPoseLink } from './model-pose-link';
import { ModelAttachment } from './model-attachment';
import { Model } from './model';
import { Transform } from './defs';
import { authorSaveHandle } from './save-handle';
import { createSaveStore } from '../core/save/store';
import { MemoryBackend } from '../core/save/storage-port';
import { createWorkerHost } from '../platform/workers/host';
/**
 * author/testing.ts: `testScene`, a scene without a browser, for a game's own unit tests. It spawns the scene's
 * entities into a real world and runs its real systems on the real fixed-step runner; input is scripted (`press`,
 * `hold`, `axis`) and saves live in memory. `ctx.text` reads the English strings of `game` (the key itself without one). What a test sees is what a player's frame computes, minus the drawing.
 */
import { createSystemRunner } from '../core/ecs/systems';
import { World, type Entity } from '../core/ecs/world';
import type { Services } from '../core/services';
import { parseMessage, renderMessage } from '../core/i18n/format';
import type { BuildBrief } from './build';
import { sceneActionHints, defaultActionHints } from './action-hints';
import { bodyOf, spawnInto } from './body';
import { Name, type GameDefinition, type InputDefinition, type SceneContext, type SceneDefinition, type SystemDefinition } from './defs';

export interface TestScene {
  readonly activityErrors: readonly unknown[];
  setActivity(facts: Pick<SceneActivityFacts, 'coverage' | 'documentHidden'>): void;
  readonly ctx: SceneContext;
  readonly world: World;
  /** Run `seconds` of frames at 60 fps. */
  run(seconds: number): void;
  /** Press a button action for the next frame. */
  press(action: string): void;
  /** Hold a button action, or set an axis (-1…1), until released with `release`. */
  hold(action: string, axis?: number): void;
  release(action: string): void;
  /** Where the scene asked to go (`ctx.scene.goto` / `restart`), in order. */
  readonly went: string[];
  /** Audio cues played. */
  readonly cues: string[];
  /** Exit once and dispose the helper-owned save store. Injected services remain caller-owned. */
  dispose(): void;
}

/** `inputs` enables local press-action hints. Defaults report inContext=true; inject services.input for remaps and modal context. */
export async function testScene(scene: SceneDefinition, o: { brief?: BuildBrief; game?: GameDefinition; inputs?: readonly InputDefinition[]; calm?: boolean; params?: Record<string, string>; seed?: number; systems?: readonly SystemDefinition[]; services?: Partial<Services> } = {}): Promise<TestScene> {
  const body = await bodyOf(scene);
  const hintSource = o.services?.input;
  const describe = sceneActionHints(o.inputs ?? [], hintSource ? id => hintSource.describeAction(id) : defaultActionHints(o.inputs ?? []));
  const strings: Record<string, string> = Object.assign(Object.fromEntries((o.inputs ?? []).map(i => [`game.input.${i.id}`, i.label])), ...(o.game?.kits ?? []).map(k => k.strings.en ?? {}), o.game?.strings?.en ?? {});
  const world = new World();
  for (const e of body.entities) spawnInto(world, e);
  const pressed = new Set<string>(), held = new Map<string, number>(), went: string[] = [], cues: string[] = [];
  // No real timers or retained timer callbacks: headless saves flush explicitly.
  const injectedSave = o.services?.save;
  const save = injectedSave ?? createSaveStore({
    local: new MemoryBackend().port(), session: new MemoryBackend().port(0, 'session'),
    build: 'test-scene', namespace: 'test-scene',
    timers: { set: () => 0, clear: () => {}, now: () => 0 },
  });
  const ownsSave = injectedSave == null;
  let disposed = false;
  const alive = () => { if (disposed) throw Error('testScene: disposed'); };
  let r = (o.seed ?? 1) >>> 0, frame = 0, t = 0;
  const ctx: SceneContext = {
    world, state: world.resources, brief: o.brief as BuildBrief,
    scene: { id: scene.id, params: o.params ?? {}, goto: id => { went.push(id); }, restart: () => { went.push(scene.id); } },
    input: { describe, pressed: id => pressed.has(id), held: id => held.has(id), axis: id => held.get(id) ?? 0, pointer: { x: 0, y: 0, down: false, pressed: false } },
    get time() { return { t, frame, calm: o.calm ?? false }; },
    view: { camera: { position: [...scene.view?.camera?.position ?? [0, 8, 10]], target: [...scene.view?.camera?.target ?? [0, 0, 0]], fov: scene.view?.camera?.fov ?? 50 }, background: scene.view?.background ?? 0x101820, aspect: 16 / 9, overlay: null, openReadingSheet: null },
    spawn: (prefab, ...extra) => spawnInto(world, prefab, extra),
    named: name => { for (const [e, n] of world.query(Name)) if (n.name === name) return e as Entity; return undefined; },
    save: def => authorSaveHandle(save, def),
    text: (key, vars) => { const m = strings[key]; return m === undefined ? key : renderMessage(parseMessage(m), vars, 'en'); },
    play: cue => { cues.push(cue); },
    modelState: entity => {
      const requested = disposed || !world.has(entity, Transform) ? undefined : world.get(entity, Model);
      return Object.freeze({ status: requested ? 'loading' : 'absent', requestedAsset: requested?.asset ?? null, adoptedAsset: null });
    },
    modelAttachmentState: entity => Object.freeze({ status: disposed || !world.has(entity, Transform) || !world.has(entity, Model) ? 'absent' : world.has(entity, ModelAttachment) ? 'unresolved' : 'unattached', held: false }),
    modelPoseLinkState: entity => Object.freeze({ status: disposed || !world.has(entity, Transform) || !world.has(entity, Model) ? 'absent' : world.has(entity, ModelPoseLink) ? 'unresolved' : 'unlinked', reason: null }),
    modelSocket: () => null,
    playVoice: cue => { cues.push(cue); return null; },
    random: () => { r = (r + 0x6D2B79F5) >>> 0; let x = r; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; },
    service: key => { const v = key === 'save' ? save : o.services?.[key]; if (!v) throw Error(`testScene: no '${String(key)}' service; pass it in services`); return v as Services[typeof key]; },
  };
  const activityErrors: unknown[] = [];
  let activityFacts: SceneActivityFacts = { phase: 'active', coverage: 'top', documentHidden: false };
  const activityEvents = scene.activity ? createSceneActivity(() => activityFacts, facts => scene.activity!(ctx, facts), error => activityErrors.push(error), dispose) : undefined;
  function dispose() {
    if (disposed) return;
    disposed = true;
    activityFacts = { ...activityFacts, phase: 'retired' };
    activityEvents?.retire();
    try { scene.exit?.(ctx); } finally { if (ownsSave) save.dispose(); }
  }
  const failures: { id: string; error: unknown }[] = [];
  const runner = createSystemRunner([...body.systems, ...o.systems ?? []], {
    report: (id, error) => { failures.push({ id, error }); },
    after: () => world.clearEvents(),
  });
  try {
    await scene.prepare?.(ctx,new AbortController().signal);
    scene.enter?.(ctx);
    activityEvents?.start();
  } catch (error) { if (ownsSave) save.dispose(); throw error; }
  return {
    ctx, world, went, cues, activityErrors,
    setActivity(facts) {
      alive();
      const coverage = facts.coverage, documentHidden = facts.documentHidden;
      if (!['top', 'scrim', 'opaque', 'hidden'].includes(coverage) || typeof documentHidden !== 'boolean') throw Error('testScene: invalid activity facts');
      activityFacts = { phase: 'active', coverage, documentHidden };
      activityEvents?.refresh();
    },
    run(seconds) {
      alive();
      const n = Math.round(seconds * 60);
      for (let i = 0; i < n; i++) {
        frame++; t += 1 / 60;
        runner.frame(ctx, 1 / 60);
        pressed.clear();
        // Report after the frame: sibling systems, events and tick accounting must finish first.
        const errors = failures.splice(0).map(({ id, error }) => {
          let detail = 'unprintable error';
          try { detail = String(error); } catch { /* Preserve the original cause even if formatting fails. */ }
          return Object.assign(Error(`system ${id} failed: ${detail}`), { cause: error, systemId: id });
        });
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, errors.map(error => error.message).join('; '));
      }
    },
    press: id => { alive(); pressed.add(id); },
    hold: (id, axis = 1) => { alive(); held.set(id, axis); },
    release: id => { alive(); held.delete(id); },
    dispose,
  };
}

/** Deterministic worker fallback for headless scene tests; caller owns disposal. */
export const createTestWorkerHost = () => createWorkerHost({createWorker:null});
