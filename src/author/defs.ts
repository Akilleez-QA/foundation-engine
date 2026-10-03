import {normalizeModelPoseLinkLimits, type ModelPoseLinkLimits, type ModelPoseLinkState} from './model-pose-link';
import type {ModelAttachmentState} from './model-attachment';
import type {ModelState} from './model-state';
import type {EnvironmentState} from './environment';
import {validateSceneOutput, type SceneOutput} from './scene-output';
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
import {component, type ComponentInit, type ComponentType, type Entity, type World} from '../core/ecs/world';
import type {Migration, SaveSection, SaveScope, SectionStatus} from '../core/save/section';
import type {ActionDescription, KeyChord, PadInput} from '../platform/input/actions';
import type {EngineModule} from '../core/module';
import type {Services} from '../core/services';
import type {BuildBrief} from './build';
import type {CueVoice, CueVoiceOptions} from '../platform/audio/audio-output';
import {validateResidency, type AssetResidencyInput} from '../platform/assets/residency';
import {validateSpatialAudioOptions, type SpatialAudioOptions} from '../platform/audio/module';
import type {AudioClockReading} from '../platform/audio/audio-timeline';
import type {MusicOptions, MusicVoice} from '../platform/audio/music-clock';
import type {SceneParticles} from './particle-contract';

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const need = (ok: boolean, message: string) => {
  if (!ok) throw Error(message);
};
const kebab = (what: string, id: string) => need(KEBAB.test(id), `${what} id '${id}' must be lowercase kebab-case`);

export type Vec3 = [x: number, y: number, z: number];

// ------------------------------------------------------------------ components and entities

/** A component type: `const Health = defineComponent('health', { hp: 3 })`; `Health({ hp: 5 })` initialises one. */
export function defineComponent<T extends object>(id: string, initial: T): ComponentType<T> {
  return component(id, initial);
}

/** Where an entity is: position, rotation (radians, Y-up) and uniform scale. */
export const Transform = defineComponent('transform', {x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1});
/** What an entity looks like, drawn by the built-in renderer: a primitive with a size in metres and a colour. */
export const Shape = defineComponent('shape', {
  kind: 'box' as 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'capsule',
  size: [1, 1, 1] as Vec3,
  color: 0xcccccc,
  visible: true,
});
/** A name, so systems, kits and tests can find an entity (`ctx.named('player')`). */
export const Name = defineComponent('name', {name: ''});

/** A prefab: a named list of component initialisers, spawned fresh (deep copies) each time. */
export interface EntityDefinition {
  readonly kind: 'entity';
  readonly id: string;
  readonly components: readonly ComponentInit<object>[];
}
export function defineEntity(e: {id: string; components: readonly ComponentInit<object>[]}): EntityDefinition {
  kebab('entity', e.id);
  const ids = e.components.map(c => c.type.id);
  need(new Set(ids).size === ids.length, `entity ${e.id}: a component type appears twice`);
  return {kind: 'entity', id: e.id, components: e.components};
}

// ------------------------------------------------------------------ the context systems and hooks receive

export interface SaveHandle<T> {
  get(): Readonly<T>;
  /** Mutate a draft; optionally attempt persistence now, outside frame execution. Exceptions do not imply rollback. */
  update(fn: (draft: T) => void, options?: {now?: boolean}): SectionStatus;
  /** Current store status; fresh defaults may report saved without an existing envelope. */
  status(): SectionStatus;
}

/** Immutable binding metadata, not a guarantee of a handler, physical glyph or touch route. */
export type ActionHint = ActionDescription;

export interface InputState {
  /** Known local press action only; unknown IDs and axes return null. Translate labelKey with ctx.text. */
  describe(action: string): ActionHint | null;
  /**
   * A fixed system sees a press in exactly one tick: the first fixed tick after it, even when frames in between ran no
   * tick (STD-SIM-12). A frame system sees it in the frame it arrived. Cancellation (overlay, hidden tab, lost
   * ownership) releases a press not yet seen.
   */
  pressed(action: string): boolean;
  /** When `pressed(action)` is true, that press's time in page monotonic milliseconds (the event's own timestamp where
   *  the device reports one; gamepads are stamped when polled), under the same lane rules: a fixed system reads the
   *  earliest press its tick took, a frame system the earliest press of its frame. Null when not pressed, or when no
   *  timestamp exists: a tick
   *  recorded or replayed by the replay kit (its log holds presses, not their times), or an `InputSource` without
   *  `pressedAt`. Same timebase as `time.now`, including while a test driver holds and steps frames. */
  pressedAt(action: string): number | null;
  /** True while the action is held. */
  held(action: string): boolean;
  /** -1…1 for an axis action (its negative and positive bindings). */
  axis(action: string): number;
  /** The pointer over the view, in normalised device coordinates (-1…1); `pressed` follows the `pressed()` rules. Read-only. */
  readonly pointer: {readonly x: number; readonly y: number; readonly down: boolean; readonly pressed: boolean};
}

/** A caller-built input source (`testScene({ input })`, a replay source): `pressedAt` is optional and reads null when
 *  absent. `ctx.input` always has it. */
export type InputSource = Omit<InputState, 'pressedAt'> & Partial<Pick<InputState, 'pressedAt'>>;

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
  camera: {position: Vec3; target: Vec3; fov: number; minWidthFov?: number; mask?: number};
  background: number;
  /** Replace this value to publish an environment change. */
  environment?: EnvironmentState | undefined;
  /** Tone mapping and exposure (author/scene-output.ts). Replace the value to publish a change
   *  (`ctx.view.output = { ...ctx.view.output, exposure: 1.2 }`): the next frame draws once with it. An invalid value
   *  is reported once and the last valid output stays. */
  output: SceneOutput;
  /** Width / height of the view (16/9 in node tests). */
  readonly aspect: number;
  /** An element over the view for HUD text and prompts (the UI kit uses it); null in node tests. */
  readonly overlay: HTMLElement | null;
  /** Aborts when this scene visit ends, for overlay controls a kit attaches to the visit. Absent in headless contexts. */
  readonly signal?: AbortSignal;
  /** Scene viewport CSS pixels; immediate delivery and visit-owned cleanup. Absent in headless contexts. */
  readonly observeSize?: (listener: (size: Readonly<{width: number; height: number}>) => void) => () => void;
  /** Optional reading/pause surface, owned by this visit; null in headless tests. */
  readonly openReadingSheet: ((options: ReadingSheetOptions) => ReadingSheet) | null;
}

export interface SceneContext {
  readonly world: World;
  /** World-wide state (score, lives, phase): the world's resources. Probes and play:snap report it. */
  readonly state: Record<string, unknown>;
  readonly scene: {
    readonly id: string;
    readonly params: Readonly<Record<string, string>>;
    goto(scene: string, params?: Record<string, string>): void;
    restart(): void;
  };
  readonly input: InputState;
  /** Seconds since the visit began, the frame count, and Calm (reduced motion: skip decorative motion). */
  readonly time: {
    readonly t: number;
    readonly frame: number;
    readonly calm: boolean;
    /** This frame's timestamp in page monotonic milliseconds (`performance.now()` timebase; 0-based in testScene). */
    readonly now: number;
  };
  readonly view: ViewState;
  readonly brief: BuildBrief;
  spawn(prefab: EntityDefinition, ...extra: readonly ComponentInit<object>[]): Entity;
  /** The entity with this `Name`, or undefined. */
  named(name: string): Entity | undefined;
  save<T>(def: SaveSectionDef<T>): SaveHandle<T>;
  /** Translated text for a string key (`defineGame({ strings })`, or a derived key), with `{name}` holes filled. */
  text(key: string, vars?: Readonly<Record<string, string | number>>): string;
  /** Play a built-in cue ('ui.click', 'ui.success', …) or one of the game's sound files (an audio asset id), with an
   *  optional volume, pitch and position in the world. Fire and forget; silent in tests, while muted and before the
   *  player's first gesture. */
  play(cue: string, options?: PlayOptions): void;
  /** Read-only observed asset readiness; does not request, retry or inspect model geometry. */
  modelState(entity: Entity): ModelState;
  /** Last reconciled presentation relation; independent of asset readiness. */
  modelAttachmentState(entity: Entity): ModelAttachmentState;
  /** Last observed weighted-pose compatibility and presentation; never triggers loading or scanning. */
  modelPoseLinkState(entity: Entity): ModelPoseLinkState;
  modelSocket(entity: Entity, name: string): Readonly<{name: string; matrix: readonly number[]}> | null;
  /** An owned cue voice; stopped on scene exit. Null when muted, locked or silent. */
  playVoice(cue: string, options?: CueVoiceOptions): CueVoice | null;
  /** Seeded: the same seed (`?seed=` in test builds) gives the same sequence. */
  random(): number;
  /** One sample of the audio context clock for an audio timeline (`createAudioTimeline`), or null when silent,
   *  locked, hidden or headless. Never creates or resumes audio. */
  audioClock(): AudioClockReading | null;
  /** A song on the audio clock (a `defineAsset({ type: 'audio' })` id), started, sought, looped and stopped at exact
   *  context times; stopped on scene exit. Null when silent, locked, hidden or headless. */
  playMusic(id: string, options?: MusicOptions): MusicVoice | null;
  /** Fetch and decode a song ahead, owned by this visit. False when silent, headless, locked before any audio, failed. */
  loadMusic(id: string): Promise<boolean>;
  /** An engine or kit service (`ctx.service('progression')`), for kits' helper functions. */
  service<K extends keyof Services>(key: K): Services[K];
}

/** How one `ctx.play` sounds. */
export interface PlayOptions {
  /** 0…1 (default 1), multiplied by the player's effects volume. */
  volume?: number;
  /** Playback rate 0.25…4 (default 1): 2 is an octave higher and twice as fast. */
  pitch?: number;
  /** Where the sound is in the world: it pans and fades with distance from the camera. Omit for a flat sound. */
  position?: Vec3;
}
/** A sound file not yet loaded may start this late; later than that, that one play is dropped. */
export const PLAY_LATE_MS = 250;

/** Throws on options `ctx.play` would refuse, naming the field. */
export function validatePlayOptions(o: PlayOptions | undefined): void {
  if (o === undefined) return;
  if (typeof o !== 'object' || o === null) throw Error('play: options must be an object');
  if (o.volume !== undefined && !(typeof o.volume === 'number' && o.volume >= 0 && o.volume <= 1))
    throw Error('play: volume must be in [0, 1]');
  if (o.pitch !== undefined && !(typeof o.pitch === 'number' && o.pitch >= 0.25 && o.pitch <= 4))
    throw Error('play: pitch must be in [0.25, 4]');
  if (
    o.position !== undefined &&
    !(Array.isArray(o.position) && o.position.length === 3 && o.position.every(Number.isFinite))
  )
    throw Error('play: position must be [x, y, z]');
}

// ------------------------------------------------------------------ systems

export interface SystemDefinition {
  readonly kind: 'system';
  readonly id: string;
  readonly phase: 'fixed' | 'frame';
  run(ctx: SceneContext, dt: number): void;
}
/** Logic: `fixed` (default) runs at a fixed 60 Hz step, identical on every machine; `frame` runs once per frame. */
export function defineSystem(s: {
  id: string;
  phase?: 'fixed' | 'frame';
  run(ctx: SceneContext, dt: number): void;
}): SystemDefinition {
  kebab('system', s.id);
  return {kind: 'system', id: s.id, phase: s.phase ?? 'fixed', run: s.run};
}

// ------------------------------------------------------------------ scenes

export interface SceneBody {
  entities?: readonly (EntityDefinition | readonly ComponentInit<object>[])[];
  systems?: readonly SystemDefinition[];
}
export interface ScenePreparationContext {
  state: Record<string, unknown>;
  text: SceneContext['text'];
  service: SceneContext['service'];
}
/**
 * The state a replay of this scene must reproduce exactly (SIM-01 replay tools: the dev/test `engine.replay` surface and
 * the replay kit's headless `replaySceneLog`). Production builds never call it. `@kits/replay`'s `replayDigest()` builds
 * one from a component selection that leaves cosmetic entities out.
 */
export interface SceneReplayDigest {
  /** Names this digest (1-128 of `A-Za-z0-9._:,;=+-`). It is part of the digest identity: a log recorded under another
   *  digest is refused, never compared. */
  readonly id: string;
  /** A plain JSON value of the replayed state, read after a fixed tick. The tool canonicalises and hashes it. */
  state(world: World): unknown;
}
export const SCENE_REPLAY_DIGEST_ID = /^[A-Za-z0-9._:,;=+-]{1,128}$/;
export interface SceneActivityFacts {
  readonly phase: 'active' | 'retired';
  readonly coverage: 'top' | 'scrim' | 'opaque' | 'hidden';
  readonly documentHidden: boolean;
}
export interface SceneInput extends SceneBody {
  /** Optional factual lifecycle notification; coverage does not prescribe gameplay or networking policy. */
  activity?(ctx: SceneContext, facts: SceneActivityFacts): void;
  /** After a successful native render call for this live visit; not GPU completion. Never simulated headlessly. */
  rendered?(ctx: SceneContext): void;
  /** Opt-in weighted-pose preparation and admission. Omit for no rig capture; {} selects documented defaults. */
  modelPoseLinks?: Partial<ModelPoseLinkLimits>;
  /** Optional replay verification: `digest` replaces the default replay digest (resources and every Transform). */
  replay?: {readonly digest?: SceneReplayDigest};
  /** Particle support and bounds (FX-01, docs/guides/particles.md): `sceneParticles({ max, emitters })`. Admitted
   *  emitters' `max` sum to at most `max` (default 4096); at most `emitters` (default 16, one draw each) are drawn.
   *  Without it the scene's emitters are not simulated or drawn (reported once). */
  particles?: SceneParticles | undefined;
  id: string;
  title: string;
  /** Open, game-defined ('level', 'menu', 'world', 'cutscene', …). */
  type?: string;
  /** The starting view: camera and background. */
  view?: {
    camera?: {position: Vec3; target: Vec3; fov?: number; minWidthFov?: number; mask?: number};
    background?: number;
    lights?: 'default' | 'none';
    environment?: EnvironmentState;
    /** Opt-in tone mapping and exposure: `{ toneMapping: 'aces', exposure: 0.9 }`. Omitted: `'none'` and 1, the
     *  picture every scene had before (docs/guides/scene-look.md). */
    output?: Partial<SceneOutput>;
  };
  /** Sound files (audio asset ids) this scene plays: fetched while it loads, so their first play is on time. */
  sounds?: readonly string[];
  /** Heavy content that should load with the scene, not with the game: a dynamic import returning a body. */
  body?: () => Promise<SceneBody | {default: SceneBody}>;
  /** Prepare required resources before first render/activation; abort follows this visit. */
  prepare?(ctx: ScenePreparationContext, signal: AbortSignal): Promise<void>;
  /** Once per visit, when the scene is active (after preparation). */
  enter?(ctx: SceneContext): void;
  /** When the scene is left. */
  exit?(ctx: SceneContext): void;
}
export interface SceneDefinition extends SceneInput {
  readonly kind: 'scene';
  readonly type: string;
}
export function defineScene(s: SceneInput): SceneDefinition {
  kebab('scene', s.id);
  const ids = (s.systems ?? []).map(x => x.id);
  need(new Set(ids).size === ids.length, `scene ${s.id}: two systems share an id`);
  for (const sound of s.sounds ?? []) kebab(`scene ${s.id} sound`, sound);
  const digest = s.replay?.digest;
  if (digest !== undefined)
    need(
      !!digest &&
        typeof digest.id === 'string' &&
        SCENE_REPLAY_DIGEST_ID.test(digest.id) &&
        typeof digest.state === 'function',
      `scene ${s.id}: replay.digest needs an id (1-128 of A-Za-z0-9._:,;=+-) and a state(world) function`,
    );
  const captured = {...s};
  if (captured.view?.output !== undefined)
    captured.view = {...captured.view, output: validateSceneOutput(captured.view.output, `scene ${s.id}: view.output`)};
  if (captured.modelPoseLinks !== undefined)
    captured.modelPoseLinks = normalizeModelPoseLinkLimits(captured.modelPoseLinks);
  need(
    captured.particles === undefined || (captured.particles as {kind?: unknown})?.kind === 'scene-particles',
    `scene ${s.id}: particles must be sceneParticles(...)`,
  );
  return {...captured, kind: 'scene', type: captured.type ?? 'scene'};
}

// ------------------------------------------------------------------ save sections

/** One save migration (the store's `Migration`). The old value comes from storage, so its true type is `unknown`; the
 *  method form lets authors annotate the shape they expect (`(old: { best: number }) => …`) without a cast. */
export type SaveMigration = Migration;
export interface SaveSectionInput<T> {
  /** '<owner>.<name>' ('run.best'); it is save data and never renamed. */
  id: string;
  initial: T;
  /** 'player' (default): progress; 'device': this browser only, never exported. */
  scope?: SaveScope;
  /** One migration per older version: `migrate[n]` turns version-n data into n+1. The version is one past the highest
   *  key (no migrations: version 1). */
  migrate?: Record<number, SaveMigration>;
  /** How two copies combine (import, two tabs). Progress never un-happens: take maxima and unions. */
  merge?(stored: T, incoming: T): T;
  /** Custom validation; the default checks the value has `initial`'s shape. Throw on unreadable data. */
  parse?(raw: unknown): T;
}
export interface SaveSectionDef<T> {
  readonly kind: 'save-section';
  readonly id: string;
  readonly section: SaveSection<T>;
}

/** The default parser: the value must have the shape of `initial` (same keys; numbers, strings, booleans, lists). */
export function shapeParser<T>(initial: T, id: string): (raw: unknown) => T {
  const fail = (why: string) => {
    throw Error(`${id}: unreadable (${why})`);
  };
  const check = (want: unknown, got: unknown, at: string): void => {
    if (want === null) {
      if (got !== null && !['string', 'number', 'boolean'].includes(typeof got)) fail(`${at} is ${typeof got}`);
      return;
    }
    if (Array.isArray(want)) {
      if (!Array.isArray(got)) fail(`${at} is not a list`);
      return;
    }
    if (typeof want === 'object') {
      if (!got || typeof got !== 'object' || Array.isArray(got)) fail(`${at} is not an object`);
      for (const k of Object.keys(want as object))
        check((want as Record<string, unknown>)[k], (got as Record<string, unknown>)[k], `${at}.${k}`);
      return;
    }
    if (typeof got !== typeof want || (typeof got === 'number' && !Number.isFinite(got)))
      fail(`${at} is not a ${typeof want}`);
  };
  return raw => {
    check(initial, raw, id);
    return structuredClone(raw) as T;
  };
}

export function defineSaveSection<T>(s: SaveSectionInput<T>): SaveSectionDef<T> {
  need(/^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/.test(s.id), `save section id '${s.id}' must be '<owner>.<name>'`);
  const steps = Object.keys(s.migrate ?? {})
    .map(Number)
    .sort((a, b) => a - b);
  need(
    steps.every((n, i) => n === i + 1),
    `${s.id}: migrations must run 1, 2, 3, … with no gaps`,
  );
  const section: SaveSection<T> = {
    id: s.id,
    scope: s.scope ?? 'player',
    version: steps.length + 1,
    initial: () => structuredClone(s.initial),
    parse: s.parse ?? shapeParser(s.initial, s.id),
    ...(s.migrate ? {migrations: s.migrate} : {}),
    ...(s.merge ? {merge: s.merge} : {}),
  };
  return {kind: 'save-section', id: s.id, section};
}

// ------------------------------------------------------------------ input

export interface Bindings {
  keys?: readonly KeyChord[];
  pad?: readonly PadInput[];
}
export interface InputInput {
  id: string;
  label: string;
  /** A button: its key and pad bindings. */
  keys?: readonly KeyChord[];
  pad?: readonly PadInput[];
  /** A tap or click on the view also presses it (touch and pointer players). */
  tap?: boolean;
  /** A button whose release matters: `ctx.input.held(id)` reports it while down. The press edge is unchanged. A tap presses without holding. */
  hold?: boolean;
  /** An axis instead of a button: the bindings that push it towards -1 and +1. */
  axis?: {negative: Bindings; positive: Bindings};
}
export interface InputDefinition extends InputInput {
  readonly kind: 'input';
}
export function defineInput(i: InputInput): InputDefinition {
  kebab('input', i.id);
  if (i.axis) {
    for (const side of ['negative', 'positive'] as const)
      need(
        !!(i.axis[side].keys?.length && i.axis[side].pad?.length),
        `input ${i.id}: the ${side} side needs a key and a pad input, so every player can reach it`,
      );
  } else
    need(
      !!(i.keys?.length && i.pad?.length),
      `input ${i.id}: give a key and a pad button, so every player can reach it`,
    );
  need(
    i.hold === undefined || (typeof i.hold === 'boolean' && !i.axis),
    `input ${i.id}: hold is a boolean for buttons only (an axis is already held)`,
  );
  return {...i, kind: 'input'};
}

// ------------------------------------------------------------------ assets, modes, kits, the game

export interface AssetDefinition {
  readonly kind: 'asset';
  readonly width?: number;
  readonly height?: number;
  readonly id: string;
  readonly type: 'texture' | 'model' | 'audio' | 'data';
  readonly url: string;
  readonly licence: string;
  readonly author: string;
  readonly source: string;
}
/** A file the game ships, with its provenance: every asset names a licence, an author and a source (STD-REN-30). */
export function defineAsset(a: Omit<AssetDefinition, 'kind'>): AssetDefinition {
  kebab('asset', a.id);
  need(
    [a.width, a.height].every(v => v === undefined || (Number.isSafeInteger(v) && v > 0 && v <= 16384)),
    `asset ${a.id}: invalid dimensions`,
  );
  need(
    !!a.licence.trim() && !!a.author.trim() && !!a.source.trim(),
    `asset ${a.id}: licence, author and source are required`,
  );
  if (a.type === 'audio')
    need(/\.(?:mp3|m4a|ogg|wav)$/i.test(a.url), `asset ${a.id}: an audio file is mp3, m4a, ogg or wav`);
  return {...a, kind: 'asset'};
}

export interface ModeDefinition {
  readonly kind: 'mode';
  readonly id: string;
  readonly title: string;
  readonly scene: string;
  readonly policy?: 'default' | 'kid-safe';
}
/** A way to play (`play`, `practice`, `learn`): where it starts, and the policy it runs under. */
export function defineMode(m: Omit<ModeDefinition, 'kind'>): ModeDefinition {
  kebab('mode', m.id);
  kebab('mode scene', m.scene);
  return {...m, kind: 'mode'};
}

/** A kit's contribution to a game: engine modules (registries, services) and definitions (scenes, inputs, sections). */
export interface KitDefinition {
  readonly kind: 'kit';
  readonly id: string;
  readonly requires: readonly string[];
  readonly modules: readonly EngineModule[];
  readonly defs: readonly AuthorDef[];
  readonly strings: Readonly<Record<string, Readonly<Record<string, string>>>>;
}
/** `strings`: the kit's own catalogues (`{ en: { 'kit.key': 'Text' } }`); a game's strings override them. */
export function defineKit(k: {
  id: string;
  requires?: readonly string[];
  modules?: readonly EngineModule[];
  defs?: readonly AuthorDef[];
  strings?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}): KitDefinition {
  kebab('kit', k.id);
  return {
    kind: 'kit',
    id: k.id,
    requires: k.requires ?? [],
    modules: k.modules ?? [],
    defs: k.defs ?? [],
    strings: k.strings ?? {},
  };
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
  /**
   * Optional asset residency (RES-01, docs/guides/asset-residency.md): per-preset texture/model byte budgets, pinned
   * critical asset ids and a pressure hook. Omitted: released assets are disposed at once.
   */
  residency?: AssetResidencyInput;
  /**
   * Spatial audio choices (docs/guides/spatial-audio.md): the HRTF voice limit per quality preset, position smoothing,
   * and whether players get the "Headphone 3D audio" setting. Omitted: the previous behaviour.
   */
  audio?: SpatialAudioOptions;
}
export interface GameDefinition extends GameInput {
  readonly kind: 'game';
}
export function defineGame(g: GameInput): GameDefinition {
  kebab('game', g.id);
  kebab('first scene', g.firstScene);
  need(/^\d+\.\d+\.\d+$/.test(g.version), `version '${g.version}' must be semver (1.2.3)`);
  const kits = (g.kits ?? []).map(k => k.id);
  need(new Set(kits).size === kits.length, 'a kit is listed twice');
  for (const k of g.kits ?? [])
    for (const r of k.requires) need(kits.includes(r), `kit ${k.id} needs kit ${r}; add it to kits`);
  if (g.residency !== undefined) validateResidency(g.residency);
  validateSpatialAudioOptions(g.audio);
  return {...g, kind: 'game'};
}

export type AuthorDef =
  | SceneDefinition
  | EntityDefinition
  | SystemDefinition
  | SaveSectionDef<unknown>
  | InputDefinition
  | AssetDefinition
  | ModeDefinition
  | KitDefinition
  | GameDefinition;
export type {ComponentType, ComponentInit, Entity, World};
