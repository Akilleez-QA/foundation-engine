/**
 * kits/replay/state.ts: creator-chosen replay state. A `SceneReplayDigest` names the state a replay must reproduce;
 * `replayDigest()` builds one from a component selection (leaving cosmetic entities out), and `observeWorld` samples it
 * into a digest trace, keeping the canonical state text as detail so a divergence can be explained field by field.
 *
 * Nothing here schedules work or keeps state between calls: the caller's existing fixed-step owner calls it per tick.
 */
import {component, type ComponentType, type World} from '../../core/ecs/world';
import {SCENE_REPLAY_DIGEST_ID, Transform, type SceneReplayDigest} from '../../author/defs';
import {captureJson, type JsonLimits} from '../network/captured-json';
import type {DigestTrace, ObserveResult} from './digest';
import {hashText, replayJson} from './hash';

/** Which world state a selection digest covers. Component and tag references may be types or their ids. */
export interface WorldSelection {
  /** Components whose fields are digested, per entity (default: [Transform]). An entity with none is not listed. */
  readonly components?: readonly (ComponentType<object> | string)[];
  /** Entities with any of these components are left out entirely (a cosmetic tag, particles, a camera rig). */
  readonly exclude?: readonly (ComponentType<object> | string)[];
  /** World resources: all (true, the default), none (false) or only the listed keys. */
  readonly resources?: boolean | readonly string[];
  /** Also digest `world.count`, which counts every entity, excluded ones included (default false). */
  readonly count?: boolean;
}
export type ReplayDigestInput = SceneReplayDigest | (WorldSelection & {readonly id?: string});

/** Selection bounds: at most this many component, exclusion and resource names, each at most 128 characters. */
export const SELECTION_LIMITS = Object.freeze({components: 64, exclude: 64, resources: 256, name: 128});

interface Selection {
  components: readonly ComponentType<object>[];
  exclude: readonly ComponentType<object>[];
  resources: boolean | readonly string[];
  count: boolean;
}

function captureSelection(s: WorldSelection): Selection {
  if (!s || typeof s !== 'object') throw Error('replay digest: selection must be an object');
  const types = (list: unknown, max: number, what: string) => {
    if (list === undefined) return undefined;
    if (!Array.isArray(list) || list.length > max)
      throw Error(`replay digest: ${what} must be a list of at most ${max}`);
    const seen = new Set<string>();
    return Object.freeze(
      (list as unknown[]).map(c => {
        const id =
          typeof c === 'string'
            ? c
            : typeof c === 'function' && typeof (c as ComponentType<object>).id === 'string'
              ? (c as ComponentType<object>).id
              : null;
        if (id === null || id.length > SELECTION_LIMITS.name)
          throw Error(`replay digest: ${what} entries must be component types or ids`);
        if (seen.has(id)) throw Error(`replay digest: ${what} lists '${id}' twice`);
        seen.add(id);
        // A component type is only its id to the world's stores; an id names the same store.
        return typeof c === 'string' ? component(c, {}) : (c as ComponentType<object>);
      }),
    );
  };
  const r = s.resources ?? true;
  if (
    typeof r !== 'boolean' &&
    (!Array.isArray(r) ||
      r.length > SELECTION_LIMITS.resources ||
      r.some(k => typeof k !== 'string' || k.length === 0 || k.length > SELECTION_LIMITS.name) ||
      new Set(r).size !== r.length)
  ) {
    throw Error(
      `replay digest: resources must be a boolean or a list of at most ${SELECTION_LIMITS.resources} distinct keys`,
    );
  }
  if (s.count !== undefined && typeof s.count !== 'boolean') throw Error('replay digest: count must be a boolean');
  return Object.freeze({
    components: types(s.components, SELECTION_LIMITS.components, 'components') ?? Object.freeze([Transform]),
    exclude: types(s.exclude, SELECTION_LIMITS.exclude, 'exclude') ?? Object.freeze([]),
    resources: typeof r === 'boolean' ? r : Object.freeze([...r].sort()),
    count: s.count ?? false,
  });
}

interface Counts {
  entities: number;
  components: Record<string, number>;
}
function selectionState(world: World, s: Selection, counts?: (c: Counts) => void): Record<string, unknown> {
  const skip = new Set<number>();
  for (const x of s.exclude) for (const [e] of world.query(x)) skip.add(e);
  const rows = new Map<number, Record<string, unknown>>();
  for (const c of s.components)
    for (const [e, value] of world.query(c)) {
      if (skip.has(e)) continue;
      let row = rows.get(e);
      if (!row) rows.set(e, (row = {}));
      row[c.id] = value;
    }
  if (counts) {
    const components: Record<string, number> = Object.fromEntries(s.components.map(c => [c.id, 0]));
    for (const row of rows.values()) for (const id of Object.keys(row)) components[id]!++; // row keys are s.components ids
    counts({entities: rows.size, components});
  }
  const out: Record<string, unknown> = {entities: [...rows].sort((a, b) => a[0] - b[0])};
  if (s.resources === true) out.resources = world.resources;
  else if (s.resources !== false)
    out.resources = Object.fromEntries(
      s.resources.filter(k => Object.hasOwn(world.resources, k)).map(k => [k, world.resources[k]]),
    );
  if (s.count) out.count = world.count;
  return out;
}

/**
 * The selected world state as a plain value: `{entities: [[id, {componentId: value}]...], resources?, count?}`, entities
 * in id (spawn) order. The value holds live component objects: serialise it before the world changes.
 */
export function selectWorldState(world: World, selection: WorldSelection = {}): Record<string, unknown> {
  return selectionState(world, captureSelection(selection));
}

const idOf = (s: Selection) => {
  const names = (l: readonly ComponentType<object>[]) => l.map(c => c.id).join(',');
  const text = `select:c=${names(s.components)};x=${names(s.exclude)};r=${s.resources === true ? 'all' : s.resources === false ? 'none' : s.resources.join(',')}${s.count ? ';n' : ''}`;
  return SCENE_REPLAY_DIGEST_ID.test(text) ? text : `select:${hashText(text)}`;
};

/**
 * A replay digest over selected components, without the excluded entities. The default id describes the selection
 * (or hashes it when long), so a log recorded under another selection is refused rather than compared.
 */
export function replayDigest(selection: WorldSelection & {readonly id?: string} = {}): SceneReplayDigest {
  const s = captureSelection(selection);
  const id = selection.id ?? idOf(s);
  if (typeof id !== 'string' || !SCENE_REPLAY_DIGEST_ID.test(id))
    throw Error('replay digest: id must be 1-128 of A-Za-z0-9._:,;=+-');
  let last: Counts | null = null;
  const digest: SceneReplayDigest = Object.freeze({
    id,
    state: (world: World) =>
      selectionState(world, s, c => {
        last = c;
      }),
  });
  probes.set(digest, () => last);
  return digest;
}
/** Selection digests and their last state call's counts (read synchronously right after a sample). */
const probes = new WeakMap<SceneReplayDigest, () => Counts | null>();

export interface DigestCoverage {
  /** First sampled tick, or -1 before any sample. */
  readonly firstTick: number;
  readonly samples: number;
  /** Listed (selected, not excluded) entities at the first sample. */
  readonly entities: number;
  /** Per selected component: listed entities that had it at the first sample. */
  readonly components: Readonly<Record<string, number>>;
  /**
   * Selected components no listed entity had on any sample so far (a misspelt id, or a component the scene never
   * uses). Their part of the digest is constant, so an `equal` says nothing about them.
   */
  readonly unmatched: readonly string[];
}
export interface DigestCoverageTracker {
  /** Call right after a sample of this digest was taken (observeWorld's `sampled`). */
  sampled(tick: number): void;
  /** Null for a digest that is not a component selection (its coverage is the creator's). */
  read(): DigestCoverage | null;
}
/** Coverage of a selection digest across one run's samples. O(selected components) per sample. */
export function createDigestCoverage(digest: SceneReplayDigest | null): DigestCoverageTracker {
  const probe = digest ? probes.get(digest) : undefined;
  let first: (Counts & {tick: number}) | null = null,
    samples = 0;
  const seen = new Set<string>(),
    all: string[] = [];
  return {
    sampled(tick) {
      const c = probe?.();
      if (!c) return;
      if (!first) {
        first = {...c, components: {...c.components}, tick};
        all.push(...Object.keys(c.components));
      }
      samples++;
      for (const [id, n] of Object.entries(c.components)) if (n > 0) seen.add(id);
    },
    read() {
      if (!probe) return null;
      return Object.freeze({
        firstTick: first?.tick ?? -1,
        samples,
        entities: first?.entities ?? 0,
        components: Object.freeze({...first?.components}),
        unmatched: Object.freeze(all.filter(id => !seen.has(id))),
      });
    },
  };
}

/** A creator digest as given, or a selection turned into one. Throws on anything else. */
export function toReplayDigest(input: ReplayDigestInput): SceneReplayDigest {
  if (input && typeof input === 'object' && probes.has(input as SceneReplayDigest)) return input as SceneReplayDigest;
  if (input && typeof input === 'object' && 'state' in input) {
    const d = input as SceneReplayDigest;
    if (typeof d.state !== 'function' || typeof d.id !== 'string' || !SCENE_REPLAY_DIGEST_ID.test(d.id))
      throw Error('replay digest: needs an id (1-128 of A-Za-z0-9._:,;=+-) and a state(world) function');
    return Object.freeze({id: d.id, state: d.state});
  }
  return replayDigest(input as WorldSelection & {id?: string});
}

/** The default digest's detail: what it covers (entity count, resources, every Transform) in the selection shape. */
const DEFAULT_DETAIL = captureSelection({components: [Transform], resources: true, count: true});

/** Canonical JSON text of a digest's state (or of the default digest's coverage). Throws over `limits`. */
export function replayStateText(world: World, digest: SceneReplayDigest | null, limits: JsonLimits): string {
  const value = digest ? digest.state(world) : selectionState(world, DEFAULT_DETAIL);
  const json = replayJson(value);
  return captureJson(json, limits).json;
}

/**
 * Observe one tick: a creator digest is the hash of its canonical state text, which is also the detail text (computed
 * once). Without a creator digest, `fallback` digests and the detail is the default coverage in the selection shape.
 * `sampled` sees each digest value the trace is given.
 */
export function observeWorld(
  trace: DigestTrace,
  tick: number,
  world: World,
  digest: SceneReplayDigest | null,
  limits: JsonLimits,
  fallback: (world: World) => string,
  sampled?: (digest: string) => void,
): ObserveResult {
  let text: string | undefined;
  const canonical = () => (text ??= replayStateText(world, digest, limits));
  const value = (d: string) => {
    sampled?.(d);
    return d;
  };
  return trace.observe(tick, digest ? () => value(hashText(canonical())) : () => value(fallback(world)), () =>
    digest ? canonical() : replayStateText(world, null, limits),
  );
}
