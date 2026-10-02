/**
 * kits/replay/state.ts: creator-chosen replay state. A `SceneReplayDigest` names the state a replay must reproduce;
 * `replayDigest()` builds one from a component selection (leaving cosmetic entities out), and `observeWorld` samples it
 * into a digest trace, keeping the canonical state text as detail so a divergence can be explained field by field.
 *
 * Nothing here schedules work or keeps state between calls: the caller's existing fixed-step owner calls it per tick.
 */
import { component, type ComponentType, type World } from '../../core/ecs/world';
import { SCENE_REPLAY_DIGEST_ID, Transform, type SceneReplayDigest } from '../../author/defs';
import { captureJson, type JsonLimits } from '../network/captured-json';
import type { DigestTrace, ObserveResult } from './digest';
import { hashText } from './hash';

/** Which world state a selection digest covers. Component and tag references may be types or their ids. */
export interface WorldSelection {
  /** Components whose fields are digested, per entity (default: [Transform]). An entity with none is not listed. */
  readonly components?: readonly (ComponentType<any> | string)[];
  /** Entities with any of these components are left out entirely (a cosmetic tag, particles, a camera rig). */
  readonly exclude?: readonly (ComponentType<any> | string)[];
  /** World resources: all (true, the default), none (false) or only the listed keys. */
  readonly resources?: boolean | readonly string[];
  /** Also digest `world.count`, which counts every entity, excluded ones included (default false). */
  readonly count?: boolean;
}
export type ReplayDigestInput = SceneReplayDigest | (WorldSelection & { readonly id?: string });

/** Selection bounds: at most this many component, exclusion and resource names, each at most 128 characters. */
export const SELECTION_LIMITS = Object.freeze({ components: 64, exclude: 64, resources: 256, name: 128 });

interface Selection { components: readonly ComponentType<any>[]; exclude: readonly ComponentType<any>[]; resources: boolean | readonly string[]; count: boolean }

function captureSelection(s: WorldSelection): Selection {
  if (!s || typeof s !== 'object') throw Error('replay digest: selection must be an object');
  const types = (list: unknown, max: number, what: string) => {
    if (list === undefined) return undefined;
    if (!Array.isArray(list) || list.length > max) throw Error(`replay digest: ${what} must be a list of at most ${max}`);
    const seen = new Set<string>();
    return Object.freeze((list as unknown[]).map(c => {
      const id = typeof c === 'string' ? c : typeof c === 'function' && typeof (c as ComponentType<any>).id === 'string' ? (c as ComponentType<any>).id : null;
      if (id === null || id.length > SELECTION_LIMITS.name) throw Error(`replay digest: ${what} entries must be component types or ids`);
      if (seen.has(id)) throw Error(`replay digest: ${what} lists '${id}' twice`);
      seen.add(id);
      // A component type is only its id to the world's stores; an id names the same store.
      return typeof c === 'string' ? component(c, {}) : c as ComponentType<any>;
    }));
  };
  const r = s.resources ?? true;
  if (typeof r !== 'boolean' && (!Array.isArray(r) || r.length > SELECTION_LIMITS.resources
    || r.some(k => typeof k !== 'string' || k.length === 0 || k.length > SELECTION_LIMITS.name) || new Set(r).size !== r.length)) {
    throw Error(`replay digest: resources must be a boolean or a list of at most ${SELECTION_LIMITS.resources} distinct keys`);
  }
  if (s.count !== undefined && typeof s.count !== 'boolean') throw Error('replay digest: count must be a boolean');
  return Object.freeze({ components: types(s.components, SELECTION_LIMITS.components, 'components') ?? Object.freeze([Transform]),
    exclude: types(s.exclude, SELECTION_LIMITS.exclude, 'exclude') ?? Object.freeze([]),
    resources: typeof r === 'boolean' ? r : Object.freeze([...r].sort()), count: s.count ?? false });
}

function selectionState(world: World, s: Selection): Record<string, unknown> {
  const skip = new Set<number>();
  for (const x of s.exclude) for (const [e] of world.query(x)) skip.add(e);
  const rows = new Map<number, Record<string, unknown>>();
  for (const c of s.components) for (const [e, value] of world.query(c)) {
    if (skip.has(e)) continue;
    let row = rows.get(e);
    if (!row) rows.set(e, row = {});
    row[c.id] = value;
  }
  const out: Record<string, unknown> = { entities: [...rows].sort((a, b) => a[0] - b[0]) };
  if (s.resources === true) out.resources = world.resources;
  else if (s.resources !== false) out.resources = Object.fromEntries(s.resources.filter(k => k in world.resources).map(k => [k, world.resources[k]]));
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
  const names = (l: readonly ComponentType<any>[]) => l.map(c => c.id).join(',');
  const text = `select:c=${names(s.components)};x=${names(s.exclude)};r=${s.resources === true ? 'all' : s.resources === false ? 'none' : s.resources.join(',')}${s.count ? ';n' : ''}`;
  return SCENE_REPLAY_DIGEST_ID.test(text) ? text : `select:${hashText(text)}`;
};

/**
 * A replay digest over selected components, without the excluded entities. The default id describes the selection
 * (or hashes it when long), so a log recorded under another selection is refused rather than compared.
 */
export function replayDigest(selection: WorldSelection & { readonly id?: string } = {}): SceneReplayDigest {
  const s = captureSelection(selection);
  const id = selection.id ?? idOf(s);
  if (typeof id !== 'string' || !SCENE_REPLAY_DIGEST_ID.test(id)) throw Error('replay digest: id must be 1-128 of A-Za-z0-9._:,;=+-');
  return Object.freeze({ id, state: (world: World) => selectionState(world, s) });
}

/** A creator digest as given, or a selection turned into one. Throws on anything else. */
export function toReplayDigest(input: ReplayDigestInput): SceneReplayDigest {
  if (input && typeof input === 'object' && 'state' in input) {
    const d = input as SceneReplayDigest;
    if (typeof d.state !== 'function' || typeof d.id !== 'string' || !SCENE_REPLAY_DIGEST_ID.test(d.id)) throw Error('replay digest: needs an id (1-128 of A-Za-z0-9._:,;=+-) and a state(world) function');
    return Object.freeze({ id: d.id, state: d.state });
  }
  return replayDigest(input as WorldSelection & { id?: string });
}

/** The default digest's detail: what it covers (entity count, resources, every Transform) in the selection shape. */
const DEFAULT_DETAIL = captureSelection({ components: [Transform], resources: true, count: true });

/** Canonical JSON text of a digest's state (or of the default digest's coverage). Throws over `limits`. */
export function replayStateText(world: World, digest: SceneReplayDigest | null, limits: JsonLimits): string {
  const value = digest ? digest.state(world) : selectionState(world, DEFAULT_DETAIL);
  const json = JSON.stringify(value);
  if (typeof json !== 'string') throw Error('replay digest: state is not JSON');
  return captureJson(json, limits).json;
}

/**
 * Observe one tick: a creator digest is the hash of its canonical state text, which is also the detail text (computed
 * once). Without a creator digest, `fallback` digests and the detail is the default coverage in the selection shape.
 * `sampled` sees each digest value the trace is given.
 */
export function observeWorld(trace: DigestTrace, tick: number, world: World, digest: SceneReplayDigest | null, limits: JsonLimits,
  fallback: (world: World) => string, sampled?: (digest: string) => void): ObserveResult {
  let text: string | undefined;
  const canonical = () => text ??= replayStateText(world, digest, limits);
  const value = (d: string) => { sampled?.(d); return d; };
  return trace.observe(tick, digest ? () => value(hashText(canonical())) : () => value(fallback(world)), () => digest ? canonical() : replayStateText(world, null, limits));
}
