/**
 * kits/replay/scene.ts: tick-input capture for a scene's fixed lane, a default world digest, and headless record and
 * replay of a scene through `testScene` (the real systems on the real fixed-step runner, with the scene's seed).
 *
 * What a fixed system reads through `ctx.input` during one tick is one log entry: the pressed and held actions, the
 * axis values and the pointer. Replaying those facts tick by tick with the same seed must give the same world.
 * The same tap serves the stock browser runtime's dev-only replay surface (src/dev/replay.ts).
 */
import {
  defineSystem,
  testScene,
  Transform,
  type GameDefinition,
  type InputDefinition,
  type InputState,
  type InputSource,
  type SceneContext,
  type SceneDefinition,
  type SceneReplayDigest,
  type SystemDefinition,
  type World,
} from '../../author';
import type {DocumentValue} from '../authoring/document';
import type {JsonLimits} from '../network/captured-json';
import {
  compareDigests,
  createDigestTrace,
  type DigestComparison,
  type DigestSnapshot,
  type DigestTraceOptions,
} from './digest';
import {digestJson, hashText} from './hash';
import {explainDivergence, type DivergenceExplanation} from './explain';
import {
  createDigestCoverage,
  observeWorld,
  replayStateText,
  toReplayDigest,
  type DigestCoverage,
  type ReplayDigestInput,
} from './state';
import {
  createReplayRecorder,
  openReplay,
  type OpenLimits,
  type OpenResult,
  type RecorderState,
  type ReplayLimits,
} from './log';

/** The fixed step `testScene` and the stock runtime use for the fixed lane (core/ecs/systems.ts default). */
export const SCENE_STEP = 1 / 60;

export interface SceneInputSpec {
  readonly id: string;
  readonly axis?: unknown;
}
/** Facts one tick observed. Omitted fields are empty / zero / an idle pointer at the origin. */
export interface SceneTickFacts {
  readonly pressed?: readonly string[];
  readonly held?: readonly string[];
  readonly axes?: Readonly<Record<string, number>>;
  readonly pointer?: Readonly<{x: number; y: number; down: boolean; pressed: boolean}> | undefined;
}

/** The configuration identity of a scene replay: the scene id and its declared input signature (sorted). */
export function sceneReplayConfig(sceneId: string, inputs: readonly SceneInputSpec[]): string {
  return `scene:${sceneId};inputs:${inputs
    .map(i => `${i.id}${i.axis ? '~' : ''}`)
    .sort()
    .join(',')}`;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Canonical tick JSON (sorted ids; empty parts omitted). Throws on an undeclared action or a non-finite number. */
export function encodeSceneTick(facts: SceneTickFacts, inputs: readonly SceneInputSpec[]): string {
  const known = new Set(inputs.map(i => i.id));
  const ids = (list: readonly string[] | undefined) => {
    const out = [...new Set(list ?? [])].sort();
    for (const id of out) if (!known.has(id)) throw Error(`replay: undeclared action '${id}'`);
    return out;
  };
  const p = ids(facts.pressed),
    h = ids(facts.held),
    a: Record<string, number> = {};
  for (const id of Object.keys(facts.axes ?? {}).sort()) {
    const v = facts.axes![id];
    if (!known.has(id)) throw Error(`replay: undeclared action '${id}'`);
    if (!finite(v)) throw Error(`replay: axis '${id}' is not finite`);
    if (v !== 0) a[id] = v;
  }
  const ptr = facts.pointer ?? {x: 0, y: 0, down: false, pressed: false};
  if (!finite(ptr.x) || !finite(ptr.y)) throw Error('replay: pointer is not finite');
  const out: Record<string, unknown> = {};
  if (Object.keys(a).length) out.a = a;
  if (h.length) out.h = h;
  if (p.length) out.p = p;
  if (ptr.x !== 0 || ptr.y !== 0 || ptr.down || ptr.pressed)
    out.x = [ptr.x === 0 ? 0 : ptr.x, ptr.y === 0 ? 0 : ptr.y, ptr.down ? 1 : 0, ptr.pressed ? 1 : 0];
  return JSON.stringify(out);
}

export interface SceneInputTap {
  /** The input systems read: the current tick's facts (or the pass-through source outside a tick). */
  readonly input: InputState;
  /** Record mode: read the live input's facts for this tick, make them current and return their canonical JSON. */
  capture(live: InputSource): string;
  /** Replay mode: make a logged tick's input current. Throws on a malformed or undeclared entry. */
  load(value: DocumentValue): void;
  /** Where reads go outside a tick: a live source, or null to keep the last tick's facts. */
  passThrough(source: InputSource | null): void;
}

const EMPTY: readonly string[] = Object.freeze([]);
/** One tick-input surface over the declared actions. Allocation per tick: the facts of that tick only. */
export function createSceneInputTap(
  inputs: readonly SceneInputSpec[],
  describe: InputState['describe'] = () => null,
): SceneInputTap {
  const known = new Set(inputs.map(i => i.id));
  let pressed: readonly string[] = EMPTY,
    held: readonly string[] = EMPTY,
    axes: Readonly<Record<string, number>> = {};
  const ptr = {x: 0, y: 0, down: false, pressed: false};
  let source: InputSource | null = null;
  const pointer = {
    get x() {
      return source ? source.pointer.x : ptr.x;
    },
    get y() {
      return source ? source.pointer.y : ptr.y;
    },
    get down() {
      return source ? source.pointer.down : ptr.down;
    },
    get pressed() {
      return source ? source.pointer.pressed : ptr.pressed;
    },
  };
  const set = (f: SceneTickFacts) => {
    pressed = f.pressed ?? EMPTY;
    held = f.held ?? EMPTY;
    axes = f.axes ?? {};
    const p = f.pointer ?? {x: 0, y: 0, down: false, pressed: false};
    ptr.x = p.x;
    ptr.y = p.y;
    ptr.down = p.down;
    ptr.pressed = p.pressed;
  };
  const input: InputState = {
    describe: id => describe(id),
    pressed: id => (source ? source.pressed(id) : pressed.includes(id)),
    // The log records which actions were pressed in a tick, not when: a recorded or replayed tick has no press
    // timestamps (capture makes the logged facts current, so even a live recorded tick reads null).
    pressedAt: id => source?.pressedAt?.(id) ?? null,
    held: id => (source ? source.held(id) : held.includes(id)),
    axis: id => (source ? source.axis(id) : (axes[id] ?? 0)),
    pointer,
  };
  return {
    input,
    capture(live) {
      const facts: {
        pressed: string[];
        held: string[];
        axes: Record<string, number>;
        pointer: SceneTickFacts['pointer'];
      } = {
        pressed: [],
        held: [],
        axes: {},
        pointer: {x: live.pointer.x, y: live.pointer.y, down: live.pointer.down, pressed: live.pointer.pressed},
      };
      for (const i of inputs) {
        if (live.pressed(i.id)) facts.pressed.push(i.id);
        if (live.held(i.id)) facts.held.push(i.id);
        const v = live.axis(i.id);
        if (v !== 0) facts.axes[i.id] = v;
      }
      const json = encodeSceneTick(facts, inputs);
      source = null;
      set(decode(JSON.parse(json)));
      return json;
    },
    load(value) {
      source = null;
      set(decode(value));
    },
    passThrough(next) {
      source = next;
    },
  };
  function decode(value: unknown): SceneTickFacts {
    const v = value as Record<string, unknown>;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('replay: tick input must be an object');
    for (const k of Object.keys(v))
      if (!['a', 'h', 'p', 'x'].includes(k)) throw Error(`replay: unknown tick field '${k}'`);
    const ids = (x: unknown) => {
      if (x === undefined) return EMPTY;
      if (!Array.isArray(x) || x.some(id => typeof id !== 'string' || !known.has(id)))
        throw Error('replay: tick actions');
      return Object.freeze([...(x as string[])]);
    };
    const a: Record<string, number> = {};
    if (v.a !== undefined) {
      if (!v.a || typeof v.a !== 'object' || Array.isArray(v.a)) throw Error('replay: tick axes');
      for (const [id, n] of Object.entries(v.a)) {
        if (!known.has(id) || !finite(n)) throw Error('replay: tick axes');
        a[id] = n;
      }
    }
    let pointer: SceneTickFacts['pointer'];
    if (v.x !== undefined) {
      const x = v.x as unknown[];
      if (
        !Array.isArray(x) ||
        x.length !== 4 ||
        !finite(x[0]) ||
        !finite(x[1]) ||
        ![0, 1].includes(x[2] as number) ||
        ![0, 1].includes(x[3] as number)
      )
        throw Error('replay: tick pointer');
      pointer = {x: x[0] as number, y: x[1] as number, down: x[2] === 1, pressed: x[3] === 1};
    }
    return {pressed: ids(v.p), held: ids(v.h), axes: a, ...(pointer ? {pointer} : {})};
  }
}

/** Default JSON limits for a world digest. Raise them for large worlds; a digest over the limit fails the trace. */
export const WORLD_DIGEST_LIMITS: JsonLimits = Object.freeze({maxBytes: 1 << 20, maxNodes: 1 << 16, maxDepth: 32});

/** The default digest source: entity count, the world's resources (as JSON) and every Transform, by entity id. */
export function worldDigestText(world: World): string {
  const transforms: number[][] = [];
  for (const [e, t] of world.query(Transform)) transforms.push([e, t.x, t.y, t.z, t.rx, t.ry, t.rz, t.scale]);
  return JSON.stringify({count: world.count, resources: world.resources, transforms});
}
/** The default world digest. Creators with other state supply their own digest function. */
export function worldDigest(world: World, limits: JsonLimits = WORLD_DIGEST_LIMITS): string {
  return digestJson(worldDigestText(world), limits);
}

export interface SceneRunOptions {
  readonly game?: GameDefinition;
  /** The scene's declared inputs; their ids are the action vocabulary of the log. */
  readonly inputs: readonly InputDefinition[];
  /** Build identity (default `<game id>@<version>`, or 'test' without a game). */
  readonly build?: string;
  /** Creator digest over their own state, as a function (identity unchanged). Takes precedence over `replayDigest`. */
  readonly digest?: (ctx: SceneContext) => string;
  /**
   * The replayed state as a named digest or a component selection (`replayDigest`). Default: the scene definition's
   * `replay.digest`, else worldDigest. Its id joins the trace identity, so it must match the log's.
   */
  readonly replayDigest?: ReplayDigestInput;
  /** Detail text for the trace's detail window. Default with a window: the canonical state text of the digest in use. */
  readonly detail?: (ctx: SceneContext) => string;
  readonly trace: Omit<DigestTraceOptions, 'identity'>;
  /** Extra fixed systems after the scene's own (tests use this to inject faults). */
  readonly systems?: readonly SystemDefinition[];
}
const buildOf = (o: SceneRunOptions) => o.build ?? (o.game ? `${o.game.id}@${o.game.version}` : 'test');
/** The digest trace identity. A named replay digest adds `|digest:<id>`; the default digest adds nothing. */
export const sceneTraceIdentity = (build: string, config: string, seed: number, digest?: string | null) =>
  `${build}|${config}|seed:${seed}${digest ? `|digest:${digest}` : ''}`;
/** The named digest a run uses: the caller's, else the scene's `replay.digest`, else none (the default digest). */
export function sceneReplayDigest(scene: SceneDefinition, input?: ReplayDigestInput | null): SceneReplayDigest | null {
  if (input != null) return toReplayDigest(input);
  return scene.replay?.digest ? toReplayDigest(scene.replay.digest) : null;
}

async function drive(
  scene: SceneDefinition,
  o: SceneRunOptions,
  seed: number,
  ticks: number,
  before: (tick: number, tap: SceneInputTap) => boolean,
) {
  const config = sceneReplayConfig(scene.id, o.inputs);
  const named = o.digest ? null : sceneReplayDigest(scene, o.replayDigest);
  const trace = createDigestTrace({...o.trace, identity: sceneTraceIdentity(buildOf(o), config, seed, named?.id)});
  const tap = createSceneInputTap(o.inputs);
  const coverage = createDigestCoverage(named);
  let tick = 0,
    observed = 0;
  const observe = defineSystem({
    id: 'replay-kit-observe',
    run(ctx) {
      observed++;
      if (o.digest) trace.observe(tick, () => o.digest!(ctx), o.detail ? () => o.detail!(ctx) : undefined);
      else if (o.detail)
        trace.observe(
          tick,
          named ? () => hashText(replayStateText(ctx.world, named, WORLD_DIGEST_LIMITS)) : () => worldDigest(ctx.world),
          () => o.detail!(ctx),
        );
      else observeWorld(trace, tick, ctx.world, named, WORLD_DIGEST_LIMITS, worldDigest, () => coverage.sampled(tick));
    },
  });
  const t = await testScene(scene, {
    game: o.game,
    inputs: o.inputs,
    seed,
    input: tap.input,
    systems: [...(o.systems ?? []), observe],
  });
  try {
    for (; tick < ticks; tick++) {
      if (!before(tick, tap)) break;
      t.run(SCENE_STEP);
      if (observed !== tick + 1) throw Error(`replay: tick ${tick} ran ${observed - tick} fixed steps, expected one`);
    }
  } finally {
    t.dispose();
  }
  return {config, trace: trace.read(), ticks: tick, coverage: coverage.read()};
}

/** Run `ticks` fixed ticks of a scene headlessly with scripted facts, recording the inputs and digests. */
export async function recordSceneRun(
  scene: SceneDefinition,
  o: SceneRunOptions & {
    seed: number;
    ticks: number;
    limits: ReplayLimits;
    script(tick: number): SceneTickFacts;
  },
): Promise<{log: string; recorder: RecorderState; digests: DigestSnapshot; coverage: DigestCoverage | null}> {
  const config = sceneReplayConfig(scene.id, o.inputs);
  const recorder = createReplayRecorder({
    header: {build: buildOf(o), config, seed: o.seed, step: SCENE_STEP},
    limits: o.limits,
  });
  const run = await drive(scene, o, o.seed, o.ticks, (tick, tap) => {
    const json = encodeSceneTick(o.script(tick), o.inputs);
    const r = recorder.record(tick, json);
    if (r.status === 'failed') throw Error(`replay: recording failed (${r.reason})`);
    if (r.status === 'truncated') return false; // the log ends here; so does the recorded run
    tap.load(JSON.parse(json));
    return true;
  });
  return {log: recorder.export(run.trace), recorder: recorder.read(), digests: run.trace, coverage: run.coverage};
}

export type SceneReplayResult =
  | Exclude<OpenResult, {status: 'ready'}>
  | Readonly<{
      status: 'replayed';
      ticks: number;
      truncatedAt: number | null;
      digests: DigestSnapshot;
      comparison: DigestComparison | null;
      /** When diverged: the first differing entity, component and field (or path), from both sides' detail text. */
      divergence: DivergenceExplanation | null;
      /** A selection digest's coverage: listed entities and components, and selected components never matched. */
      coverage: DigestCoverage | null;
    }>;

/**
 * Replay a log headlessly: same build, configuration and step (else refused), the log's seed, one logged input per
 * tick. Compares against the log's embedded digests when it has them.
 */
export async function replaySceneLog(
  scene: SceneDefinition,
  o: SceneRunOptions & {log: string; limits: OpenLimits},
): Promise<SceneReplayResult> {
  const opened = openReplay(o.log, o.limits, {
    build: buildOf(o),
    config: sceneReplayConfig(scene.id, o.inputs),
    step: SCENE_STEP,
  });
  if (opened.status !== 'ready') return opened;
  const player = opened.player;
  const run = await drive(scene, o, player.header.seed, player.ticks, (tick, tap) => {
    tap.load(player.input(tick)!);
    return true;
  });
  const comparison = player.digests ? compareDigests(player.digests, run.trace) : null;
  let divergence: DivergenceExplanation | null = null;
  if (comparison?.status === 'diverged') {
    try {
      divergence = explainDivergence(comparison.tick, comparison.detail.a, comparison.detail.b);
    } catch {
      divergence = Object.freeze({status: 'unavailable', tick: comparison.tick, reason: 'detail-unreadable'});
    }
  }
  return Object.freeze({
    status: 'replayed',
    ticks: run.ticks,
    truncatedAt: player.truncatedAt,
    digests: run.trace,
    comparison,
    divergence,
    coverage: run.coverage,
  });
}
