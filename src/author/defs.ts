import { normalizeModelPoseLinkLimits, type ModelPoseLinkLimits, type ModelPoseLinkState } from './model-pose-link';
import type { ModelAttachmentState } from './model-attachment';
import type { ModelState } from './model-state';
import type { EnvironmentState } from './environment';
/**
 * author/defs.ts: the author-facing definitions. Each `define*` checks its input and returns plain data tagged with a
 * `kind`; `compile.ts` turns the set into engine modules (registries, router, save, input). Nothing here runs a frame,
 * touches the DOM or imports three.js, so a game's definitions are cheap to load and easy to test.
 *
 * The model is genre-neutral: a game is scenes (any state or world: a level, a menu, a board, a cutscene); a scene is
 * entities made of components, driven by systems; controls are named input actions and axes that systems read.
 * Genre patterns (move-and-interact scenes, achievements, follow cameras, character control, HUDs, lessons) are
 * optional kits built on this same surface.
 */
import { component, type ComponentInit, type ComponentType, type Entity, type World } from '../core/ecs/world';
import type { SaveSection, SaveScope, SectionStatus } from '../core/save/section';
import type { ActionDescription, KeyChord, PadInput } from '../platform/input/actions';
import type { EngineModule } from '../core/module';
import type { Services } from '../core/services';
import type { BuildBrief } from './build';
import type { CueVoice, CueVoiceOptions } from '../platform/audio/audio-output';

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const need = (ok: boolean, message: string) => { if (!ok) throw Error(message); };
const kebab = (what: string, id: string) => need(KEBAB.test(id), `${what} id '${id}' must be lowercase kebab-case`);

export type Vec3 = [x: number, y: number, z: number];

// ------------------------------------------------------------------ components and entities

/** A component type: `const Health = defineComponent('health', { hp: 3 })`; `Health({ hp: 5 })` initialises one. */
export function defineComponent<T extends object>(id: string, initial: T): ComponentType<T> { return component(id, initial); }

/** Where an entity is: position, rotation (radians, Y-up) and uniform scale. */
export const Transform = defineComponent('transform', { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 });
/** What an entity looks like, drawn by the built-in renderer: a primitive with a size in metres and a colour. */
export const Shape = defineComponent('shape', { kind: 'box' as 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'capsule', size: [1, 1, 1] as Vec3, color: 0xcccccc, visible: true });
/** A name, so systems, kits and tests can find an entity (`ctx.named('player')`). */
export const Name = defineComponent('name', { name: '' });

/** A prefab: a named list of component initialisers, spawned fresh (deep copies) each time. */
export interface EntityDefinition { readonly kind: 'entity'; readonly id: string; readonly components: readonly ComponentInit<object>[] }
export function defineEntity(e: { id: string; components: readonly ComponentInit<object>[] }): EntityDefinition {
  kebab('entity', e.id);
  const ids = e.components.map(c => c.type.id);
  need(new Set(ids).size === ids.length, `entity ${e.id}: a component type appears twice`);
  return { kind: 'entity', id: e.id, components: e.components };
}

// ------------------------------------------------------------------ the context systems and hooks receive

export interface SaveHandle<T> {
  get(): Readonly<T>;
  /** Mutate a draft; optionally attempt persistence now, outside frame execution. Exceptions do not imply rollback. */
  update(fn: (draft: T) => void, options?: { now?: boolean }): SectionStatus;
  /** Current store status; fresh defaults may report saved without an existing envelope. */
  status(): SectionStatus;
}

/** Immutable binding metadata, not a guarantee of a handler, physical glyph or touch route. */
export type ActionHint = ActionDescription;

export interface InputState {
  /** Known local press action only; unknown IDs and axes return null. Translate labelKey with ctx.text. */
  describe(action: string): ActionHint | null;
  /** True in the frame the action was pressed. */
  pressed(action: string): boolean;
  /** True while the action is held. */
  held(action: string): boolean;
  /** -1…1 for an axis action (its negative and positive bindings). */
  axis(action: string): number;
  /** The pointer over the view, in normalised device coordinates (-1…1), and whether it went down this frame. */
  readonly pointer: { x: number; y: number; down: boolean; pressed: boolean };
}

/** One visit-owned reading surface. Cancellation resolves ready with an aborted signal; entry failures reject it. */
export interface ReadingSheet {
  readonly signal: AbortSignal;
  readonly ready: Promise<void>;
  close(): void;
}
export interface ReadingSheetOptions {
  id: string;
  element: HTMLElement;
  initialFocus: () => HTMLElement | null;
  returnFocus: () => HTMLElement | null;
}

export interface ViewState {
  /** The camera the scene is drawn with. Systems (or the camera kit) move it; changes are drawn next frame. */
  /** `fov` is vertical, in degrees. `minWidthFov` (degrees) keeps at least that much horizontal view on a narrow
   *  (portrait) screen by widening the vertical field of view, so a phone sees the whole play area. */
  camera: { position: Vec3; target: Vec3; fov: number; minWidthFov?: number; mask?: number };
  background: number;
  /** Replace this value to publish an environment change. */
  environment?: EnvironmentState;
  /** Width / height of the view (16/9 in node tests). */
  readonly aspect: number;
  /** An element over the view for HUD text and prompts (the UI kit uses it); null in node tests. */
  readonly overlay: HTMLElement | null;
  /** Scene viewport CSS pixels; immediate delivery and visit-owned cleanup. Absent in headless contexts. */
  readonly observeSize?: (listener: (size: Readonly<{ width: number; height: number }>) => void) => () => void;
  /** Optional reading/pause surface, owned by this visit; null in headless tests. */
  readonly openReadingSheet: ((options: ReadingSheetOptions) => ReadingSheet) | null;
}

export interface SceneContext {
  readonly world: World;
  /** World-wide state (score, lives, phase): the world's resources. Probes and play:snap report it. */
  readonly state: Record<string, unknown>;
  readonly scene: { readonly id: string; readonly params: Readonly<Record<string, string>>; goto(scene: string, params?: Record<string, string>): void; restart(): void };
  readonly input: InputState;
  /** Seconds since the visit began, the frame count, and Calm (reduced motion: skip decorative motion). */
  readonly time: { readonly t: number; readonly frame: number; readonly calm: boolean };
  readonly view: ViewState;
  readonly brief: BuildBrief;
  spawn(prefab: EntityDefinition, ...extra: readonly ComponentInit<object>[]): Entity;
  /** The entity with this `Name`, or undefined. */
  named(name: string): Entity | undefined;
  save<T>(def: SaveSectionDef<T>): SaveHandle<T>;
  /** Translated text for a string key (`defineGame({ strings })`, or a derived key), with `{name}` holes filled. */
  text(key: string, vars?: Readonly<Record<string, string | number>>): string;
  /** An audio cue ('ui.click', 'ui.success', …); silent in tests. */
  play(cue: string): void;
  /** Read-only observed asset readiness; does not request, retry or inspect model geometry. */
  modelState(entity: Entity): ModelState;
  /** Last reconciled presentation relation; independent of asset readiness. */
  modelAttachmentState(entity: Entity): ModelAttachmentState;
  /** Last observed weighted-pose compatibility and presentation; never triggers loading or scanning. */
  modelPoseLinkState(entity: Entity): ModelPoseLinkState;
  modelSocket(entity: Entity, name: string): Readonly<{ name: string; matrix: readonly number[] }> | null;
  /** An owned cue voice; stopped on scene exit. Null when muted, locked or silent. */
  playVoice(cue: string, options?: CueVoiceOptions): CueVoice | null;
  /** Seeded: the same seed (`?seed=` in test builds) gives the same sequence. */
  random(): number;
  /** An engine or kit service (`ctx.service('progression')`), for kits' helper functions. */
  service<K extends keyof Services>(key: K): Services[K];
}

// ------------------------------------------------------------------ systems

export interface SystemDefinition { readonly kind: 'system'; readonly id: string; readonly phase: 'fixed' | 'frame'; run(ctx: SceneContext, dt: number): void }
/** Logic: `fixed` (default) runs at a fixed 60 Hz step, identical on every machine; `frame` runs once per frame. */
export function defineSystem(s: { id: string; phase?: 'fixed' | 'frame'; run(ctx: SceneContext, dt: number): void }): SystemDefinition {
  kebab('system', s.id);
  return { kind: 'system', id: s.id, phase: s.phase ?? 'fixed', run: s.run };
}

// ------------------------------------------------------------------ scenes

export interface SceneBody { entities?: readonly (EntityDefinition | readonly ComponentInit<object>[])[]; systems?: readonly SystemDefinition[] }
export interface ScenePreparationContext {
  state: Record<string,unknown>;
  text: SceneContext['text'];
  service: SceneContext['service'];
}
export interface SceneActivityFacts { readonly phase: 'active' | 'retired'; readonly coverage: 'top' | 'scrim' | 'opaque' | 'hidden'; readonly documentHidden: boolean }
export interface SceneInput extends SceneBody {
  /** Optional factual lifecycle notification; coverage does not prescribe gameplay or networking policy. */
  activity?(ctx: SceneContext, facts: SceneActivityFacts): void;
  /** After a successful native render call for this live visit; not GPU completion. Never simulated headlessly. */
  rendered?(ctx: SceneContext): void;
  /** Opt-in weighted-pose preparation and admission. Omit for no rig capture; {} selects documented defaults. */
  modelPoseLinks?: Partial<ModelPoseLinkLimits>;
  id: string;
  title: string;
  /** Open, game-defined ('level', 'menu', 'world', 'cutscene', …). */
  type?: string;
  /** The starting view: camera and background. */
  view?: { camera?: { position: Vec3; target: Vec3; fov?: number; minWidthFov?: number; mask?: number }; background?: number; lights?: 'default' | 'none'; environment?: EnvironmentState };
  /** Heavy content that should load with the scene, not with the game: a dynamic import returning a body. */
  body?: () => Promise<SceneBody | { default: SceneBody }>;
  /** Prepare required resources before first render/activation; abort follows this visit. */
  prepare?(ctx: ScenePreparationContext, signal: AbortSignal): Promise<void>;
  /** Once per visit, when the scene is active (after preparation). */
  enter?(ctx: SceneContext): void;
  /** When the scene is left. */
  exit?(ctx: SceneContext): void;
}
export interface SceneDefinition extends SceneInput { readonly kind: 'scene'; readonly type: string }
export function defineScene(s: SceneInput): SceneDefinition {
  kebab('scene', s.id);
  const ids = (s.systems ?? []).map(x => x.id);
  need(new Set(ids).size === ids.length, `scene ${s.id}: two systems share an id`);
  const captured = { ...s };
  if (captured.modelPoseLinks !== undefined) captured.modelPoseLinks = normalizeModelPoseLinkLimits(captured.modelPoseLinks);
  return { ...captured, kind: 'scene', type: captured.type ?? 'scene' };
}

// ------------------------------------------------------------------ save sections

export interface SaveSectionInput<T> {
  /** '<owner>.<name>' ('run.best'); it is save data and never renamed. */
  id: string;
  initial: T;
  /** 'player' (default): progress; 'device': this browser only, never exported. */
  scope?: SaveScope;
  /** One migration per older version: `migrate[n]` turns version-n data into n+1. The version is one past the highest
   *  key (no migrations: version 1). */
  migrate?: Record<number, (old: any) => unknown>;
  /** How two copies combine (import, two tabs). Progress never un-happens: take maxima and unions. */
  merge?(stored: T, incoming: T): T;
  /** Custom validation; the default checks the value has `initial`'s shape. Throw on unreadable data. */
  parse?(raw: unknown): T;
}
export interface SaveSectionDef<T> { readonly kind: 'save-section'; readonly id: string; readonly section: SaveSection<T> }

/** The default parser: the value must have the shape of `initial` (same keys; numbers, strings, booleans, lists). */
export function shapeParser<T>(initial: T, id: string): (raw: unknown) => T {
  const fail = (why: string) => { throw Error(`${id}: unreadable (${why})`); };
  const check = (want: unknown, got: unknown, at: string): void => {
    if (want === null) { if (got !== null && !['string', 'number', 'boolean'].includes(typeof got)) fail(`${at} is ${typeof got}`); return; }
    if (Array.isArray(want)) { if (!Array.isArray(got)) fail(`${at} is not a list`); return; }
    if (typeof want === 'object') {
      if (!got || typeof got !== 'object' || Array.isArray(got)) fail(`${at} is not an object`);
      for (const k of Object.keys(want as object)) check((want as Record<string, unknown>)[k], (got as Record<string, unknown>)[k], `${at}.${k}`);
      return;
    }
    if (typeof got !== typeof want || (typeof got === 'number' && !Number.isFinite(got))) fail(`${at} is not a ${typeof want}`);
  };
  return raw => { check(initial, raw, id); return structuredClone(raw) as T; };
}

export function defineSaveSection<T>(s: SaveSectionInput<T>): SaveSectionDef<T> {
  need(/^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/.test(s.id), `save section id '${s.id}' must be '<owner>.<name>'`);
  const steps = Object.keys(s.migrate ?? {}).map(Number).sort((a, b) => a - b);
  need(steps.every((n, i) => n === i + 1), `${s.id}: migrations must run 1, 2, 3, … with no gaps`);
  const section: SaveSection<T> = {
    id: s.id, scope: s.scope ?? 'player', version: steps.length + 1,
    initial: () => structuredClone(s.initial), parse: s.parse ?? shapeParser(s.initial, s.id),
    ...(s.migrate ? { migrations: s.migrate } : {}), ...(s.merge ? { merge: s.merge } : {}),
  };
  return { kind: 'save-section', id: s.id, section };
}

// ------------------------------------------------------------------ input

export interface Bindings { keys?: readonly KeyChord[]; pad?: readonly PadInput[] }
export interface InputInput {
  id: string;
  label: string;
  /** A button: its key and pad bindings. */
  keys?: readonly KeyChord[];
  pad?: readonly PadInput[];
  /** A tap or click on the view also presses it (touch and pointer players). */
  tap?: boolean;
  /** An axis instead of a button: the bindings that push it towards -1 and +1. */
  axis?: { negative: Bindings; positive: Bindings };
}
export interface InputDefinition extends InputInput { readonly kind: 'input' }
export function defineInput(i: InputInput): InputDefinition {
  kebab('input', i.id);
  if (i.axis) {
    for (const side of ['negative', 'positive'] as const) need(!!(i.axis[side].keys?.length && i.axis[side].pad?.length), `input ${i.id}: the ${side} side needs a key and a pad input, so every player can reach it`);
  } else need(!!(i.keys?.length && i.pad?.length), `input ${i.id}: give a key and a pad button, so every player can reach it`);
  return { ...i, kind: 'input' };
}

// ------------------------------------------------------------------ assets, modes, kits, the game

export interface AssetDefinition { readonly kind: 'asset'; readonly width?: number; readonly height?: number; readonly id: string; readonly type: 'texture' | 'model' | 'audio' | 'data'; readonly url: string; readonly licence: string; readonly author: string; readonly source: string }
/** A file the game ships, with its provenance: every asset names a licence, an author and a source (STD-REN-30). */
export function defineAsset(a: Omit<AssetDefinition, 'kind'>): AssetDefinition {
  kebab('asset', a.id);
  need([a.width,a.height].every(v=>v===undefined||(Number.isSafeInteger(v)&&v>0&&v<=16384)), `asset ${a.id}: invalid dimensions`);
  need(!!a.licence.trim() && !!a.author.trim() && !!a.source.trim(), `asset ${a.id}: licence, author and source are required`);
  return { ...a, kind: 'asset' };
}

export interface ModeDefinition { readonly kind: 'mode'; readonly id: string; readonly title: string; readonly scene: string; readonly policy?: 'default' | 'kid-safe' }
/** A way to play (`play`, `practice`, `learn`): where it starts, and the policy it runs under. */
export function defineMode(m: Omit<ModeDefinition, 'kind'>): ModeDefinition {
  kebab('mode', m.id); kebab('mode scene', m.scene);
  return { ...m, kind: 'mode' };
}

/** A kit's contribution to a game: engine modules (registries, services) and definitions (scenes, inputs, sections). */
export interface KitDefinition { readonly kind: 'kit'; readonly id: string; readonly requires: readonly string[]; readonly modules: readonly EngineModule[]; readonly defs: readonly AuthorDef[]; readonly strings: Readonly<Record<string, Readonly<Record<string, string>>>> }
/** `strings`: the kit's own catalogues (`{ en: { 'kit.key': 'Text' } }`); a game's strings override them. */
export function defineKit(k: { id: string; requires?: readonly string[]; modules?: readonly EngineModule[]; defs?: readonly AuthorDef[]; strings?: Readonly<Record<string, Readonly<Record<string, string>>>> }): KitDefinition {
  kebab('kit', k.id);
  return { kind: 'kit', id: k.id, requires: k.requires ?? [], modules: k.modules ?? [], defs: k.defs ?? [], strings: k.strings ?? {} };
}

export interface GameInput {
  id: string;
  title: string;
  version: string;
  /** The scene the game opens on (an unknown address lands here too). */
  firstScene: string;
  /** The kits this game uses, each configured by its own function (`progression({ achievements })`). */
  kits?: readonly KitDefinition[];
  /** Extra string catalogues: `{ en: { 'game.hud.score': 'Score' } }`. */
  strings?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}
export interface GameDefinition extends GameInput { readonly kind: 'game' }
export function defineGame(g: GameInput): GameDefinition {
  kebab('game', g.id); kebab('first scene', g.firstScene);
  need(/^\d+\.\d+\.\d+$/.test(g.version), `version '${g.version}' must be semver (1.2.3)`);
  const kits = (g.kits ?? []).map(k => k.id);
  need(new Set(kits).size === kits.length, 'a kit is listed twice');
  for (const k of g.kits ?? []) for (const r of k.requires) need(kits.includes(r), `kit ${k.id} needs kit ${r}; add it to kits`);
  return { ...g, kind: 'game' };
}

export type AuthorDef = SceneDefinition | EntityDefinition | SystemDefinition | SaveSectionDef<any> | InputDefinition | AssetDefinition | ModeDefinition | KitDefinition | GameDefinition;
export type { ComponentType, ComponentInit, Entity, World };
