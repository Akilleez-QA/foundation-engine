/**
 * dev/replay.ts: the dev/test-only replay surface behind `window.engine.replay` (SIM-01). Loaded on first use by the
 * test API, which the dev server and `vite build --mode test` add; production builds never contain it.
 *
 * `start({mode: 'record'})` re-enters the current scene and records, from its arrival, what each fixed tick's systems
 * read through `ctx.input`, plus a world digest at the requested cadence. `start({mode: 'replay', log})` re-enters it
 * and feeds the logged input tick by tick, then compares digests with the log's. Both need the page's `?seed=`.
 * The log is returned as text to the caller; nothing is stored, uploaded or sent.
 */
import { installSceneTickTap, type SceneTickTap, type SceneTickTapContext } from '../author/scene-tick-tap';
import {
  compareDigests, createDigestTrace, createReplayRecorder, createSceneInputTap, openReplay, sceneReplayConfig, sceneTraceIdentity,
  RUN_OVERHEAD_BYTES, worldDigest, type DigestComparison, type DigestSnapshot, type OpenLimits,
} from '../kits/replay';
import type { JsonLimits } from '../kits/network/captured-json';

export interface ReplayDevRequest {
  readonly mode: 'record' | 'replay';
  /** Replay: the log text a recording returned. */
  readonly log?: string;
  /** Digest cadence in ticks (record; a replay uses the log's). Default 1. */
  readonly every?: number;
  /** Record: most ticks (default 3600, one minute at 60 Hz). */
  readonly maxTicks?: number;
  /** Record: most retained input bytes (default 256 KiB). */
  readonly maxBytes?: number;
  /** Digest ring capacity (default: every sample of maxTicks). */
  readonly maxDigests?: number;
}
export type ReplayDevStatus = 'idle' | 'armed' | 'recording' | 'truncated' | 'replaying' | 'complete' | 'stopped' | 'refused' | 'failed';
export interface ReplayDevState {
  readonly status: ReplayDevStatus;
  readonly mode: 'record' | 'replay' | null;
  readonly reason: string | null;
  readonly scene: string | null;
  /** Ticks recorded or replayed so far. */
  readonly ticks: number;
  /** Replay: the log's tick count. */
  readonly total: number | null;
  /** Record: the log so far (local text). */
  readonly log: string | null;
  readonly digests: DigestSnapshot | null;
  /** Replay, once complete: this run's digests against the log's. */
  readonly comparison: DigestComparison | null;
}
export type ReplayStart = Readonly<{ status: 'started'; state: ReplayDevState }> | Readonly<{ status: 'refused'; reason: string }>;

const INPUT = Object.freeze({ maxBytes: 4096, maxNodes: 256, maxDepth: 4 });
const LOG: JsonLimits = Object.freeze({ maxBytes: 8 << 20, maxNodes: 1 << 20, maxDepth: 8 });
const MAX_TICKS = 1 << 20;
/** Upper bounds of one exported log's text, used to refuse a recording request whose log could not be reopened. */
const HEADER_BYTES = 2048, HEADER_NODES = 64, DIGEST_ENTRY_BYTES = 40, RUN_ENTRY_BYTES = 24;
/**
 * The worst-case size of a log a record request can export: inputs embedded as JSON strings at most double in size
 * when escaped; each run and digest entry adds its own brackets, count/tick and separators; three nodes per entry.
 */
export function recordLogBound(maxTicks: number, maxBytes: number, maxDigests: number): { bytes: number; nodes: number } {
  const runs = Math.min(maxTicks, Math.floor(maxBytes / (RUN_OVERHEAD_BYTES + 2)));
  return { bytes: HEADER_BYTES + 2 * maxBytes + runs * RUN_ENTRY_BYTES + maxDigests * DIGEST_ENTRY_BYTES,
    nodes: HEADER_NODES + 3 * runs + 3 * maxDigests };
}
const positive = (n: unknown, max: number): n is number => Number.isSafeInteger(n) && (n as number) > 0 && (n as number) <= max;

interface Session {
  mode: 'record' | 'replay';
  status: ReplayDevStatus;
  reason: string | null;
  scene: string | null;
  ticks: () => number;
  total: number | null;
  log: () => string | null;
  digests: () => DigestSnapshot | null;
  comparison: DigestComparison | null;
  stop: (reason: string | null) => void;
}

export interface ReplayDev {
  /** Validate and arm a request for the next scene visit. The caller then re-enters the scene. */
  arm(request: ReplayDevRequest, scene: string): ReplayStart;
  read(): ReplayDevState;
  /** Stop the current session: recording ends (its log stays readable); a replay hands input back to the player; an
   *  armed request is disarmed. The status becomes 'stopped' with `reason`. */
  stop(reason?: string): void;
  dispose(): void;
}

/** `log` overrides the log text limits (tests use small ones to reach the boundary); default 8 MiB / 2^20 nodes. */
export function createReplayDev(options: { log?: JsonLimits } = {}): ReplayDev {
  const logLimits: JsonLimits = options.log ?? LOG;
  let armed: { request: ReplayDevRequest; scene: string; open: OpenLimits } | null = null;
  let session: Session | null = null;
  const refuse = (reason: string): ReplayStart => Object.freeze({ status: 'refused', reason });

  const restore = installSceneTickTap(ctx => {
    if (!armed) return null;
    const { request, scene, open } = armed;
    armed = null;
    const s: Session = { mode: request.mode, status: 'armed', reason: null, scene: ctx.scene, ticks: () => 0, total: null,
      log: () => null, digests: () => null, comparison: null, stop: () => {} };
    session = s;
    const fail = (status: 'refused' | 'failed', reason: string) => { s.status = status; s.reason = reason; return null; };
    if (ctx.scene !== scene) return fail('refused', 'scene-changed');
    if (ctx.seed === null) return fail('refused', 'seed-required');
    return request.mode === 'record' ? record(ctx, request, s) : replay(ctx, request, open, s, fail);
  });

  function record(ctx: SceneTickTapContext, request: ReplayDevRequest, s: Session): SceneTickTap {
    const build = `${ctx.game.id}@${ctx.game.version}`, config = sceneReplayConfig(ctx.scene, ctx.inputs);
    const maxTicks = request.maxTicks ?? 3600, every = request.every ?? 1;
    const recorder = createReplayRecorder({ header: { build, config, seed: ctx.seed!, step: ctx.step },
      limits: { maxTicks, maxBytes: request.maxBytes ?? 256 << 10, input: INPUT } });
    const trace = createDigestTrace({ identity: sceneTraceIdentity(build, config, ctx.seed!), every,
      maxEntries: request.maxDigests ?? Math.ceil(maxTicks / every), maxDigestLength: 16 });
    const tap = createSceneInputTap(ctx.inputs, id => ctx.live.describe(id));
    tap.passThrough(ctx.live);
    let arrived = false, recording = true, tick = 0;
    const end = (status: ReplayDevStatus, reason: string | null) => { if (!recording) return; recording = false; s.status = status; s.reason = reason; tap.passThrough(ctx.live); };
    // The export changes only when a tick is recorded or recording ends: cache it between polls.
    let cached: { key: string; log: string | null } | null = null;
    Object.assign(s, {
      ticks: () => tick, digests: () => trace.read(),
      log: () => {
        const key = `${tick}|${recording}`;
        if (cached?.key !== key) cached = { key, log: recorder.read().status === 'failed' ? null : recorder.export(trace.read()) };
        return cached.log;
      },
      stop: (reason: string | null) => end('stopped', reason),
    });
    return {
      input: tap.input,
      running: () => arrived,
      beforeTick() {
        if (!recording) return;
        const r = recorder.record(tick, tap.capture(ctx.live));
        if (r.status === 'truncated') end('truncated', `maxTicks or maxBytes reached at tick ${r.truncatedAt}`);
        else if (r.status === 'failed') end('failed', r.reason);
      },
      afterTick() {
        if (!recording) return;
        if (trace.observe(tick, () => worldDigest(ctx.world)) === 'failed') { end('failed', trace.read().reason); return; }
        tick++;
        tap.passThrough(ctx.live);
      },
      arrive() { arrived = true; if (recording) s.status = 'recording'; },
      retire() { end('stopped', 'visit-ended'); },
    };
  }

  function replay(ctx: SceneTickTapContext, request: ReplayDevRequest, open: OpenLimits, s: Session,
    fail: (status: 'refused' | 'failed', reason: string) => null): SceneTickTap | null {
    const build = `${ctx.game.id}@${ctx.game.version}`, config = sceneReplayConfig(ctx.scene, ctx.inputs);
    const opened = openReplay(request.log!, open, { build, config, step: ctx.step, seed: ctx.seed });
    if (opened.status !== 'ready') return fail('refused', opened.status === 'incompatible' ? `incompatible-${opened.field}` : opened.status === 'corrupt' ? `corrupt-${opened.reason}` : opened.status);
    const player = opened.player, recorded = player.digests;
    const tap = createSceneInputTap(ctx.inputs, id => ctx.live.describe(id));
    // Decode every distinct logged input against this scene's declared actions before any tick runs.
    for (let t = 0, previous: string | undefined; t < player.ticks; t++) {
      const json = player.json(t);
      if (json === previous) continue;
      previous = json;
      try { tap.load(player.input(t)!); } catch { return fail('refused', `invalid-tick-input-${t}`); }
    }
    tap.load({});
    const every = recorded?.every ?? request.every ?? 1;
    const trace = createDigestTrace({ identity: sceneTraceIdentity(build, config, ctx.seed!), every,
      maxEntries: request.maxDigests ?? Math.max(1, Math.ceil(player.ticks / every)), maxDigestLength: 16 });
    let arrived = false, playing = true, tick = 0;
    const end = (status: ReplayDevStatus, reason: string | null = null) => {
      if (!playing) return;
      playing = false; s.status = status; s.reason = reason;
      if (status !== 'complete' || !recorded) return;
      // An empty log has nothing to compare: say so rather than claim a pass.
      s.comparison = player.ticks === 0 ? Object.freeze({ status: 'incomparable', reason: 'no-overlap' })
        : compareDigests(recorded, trace.read(), { through: player.ticks - 1 });
    };
    Object.assign(s, { total: player.ticks, ticks: () => tick, digests: () => trace.read(), stop: (reason: string | null) => { end('stopped', reason); tap.passThrough(ctx.live); } });
    if (player.ticks === 0) end('complete');
    return {
      input: tap.input,
      // The whole runner holds before arrival and once the log is spent (the scene stays frozen until re-entry or
      // stop()); ticks already due in that last frame keep the last logged input and are not observed. After stop()
      // the player's live input drives it again.
      running: () => arrived && (playing ? tick < player.ticks : s.status === 'stopped'),
      beforeTick() {
        if (!playing) return;
        try { tap.load(player.input(tick)!); } catch { end('failed', `invalid-tick-input-${tick}`); }
      },
      afterTick() {
        if (!playing) return;
        if (trace.observe(tick, () => worldDigest(ctx.world)) === 'failed') { end('failed', trace.read().reason); return; }
        if (++tick >= player.ticks) end('complete');
      },
      arrive() { arrived = true; if (playing) s.status = 'replaying'; ctx.invalidate(); },
      retire() { end('stopped', 'visit-ended'); },
    };
  }

  return {
    arm(request, scene) {
      if (!request || (request.mode !== 'record' && request.mode !== 'replay')) return refuse('mode');
      if (request.every !== undefined && !positive(request.every, MAX_TICKS)) return refuse('every');
      if (request.maxTicks !== undefined && !positive(request.maxTicks, MAX_TICKS)) return refuse('maxTicks');
      if (request.maxBytes !== undefined && !positive(request.maxBytes, LOG.maxBytes)) return refuse('maxBytes');
      if (request.maxDigests !== undefined && !positive(request.maxDigests, MAX_TICKS)) return refuse('maxDigests');
      const open: OpenLimits = { maxTicks: MAX_TICKS, maxBytes: logLimits.maxBytes, input: INPUT, log: logLimits, digests: { maxEntries: MAX_TICKS, maxDigestLength: 16 } };
      if (request.mode === 'record') {
        // Refuse a request whose log could exceed the limits it must be reopened under.
        const maxTicks = request.maxTicks ?? 3600, every = request.every ?? 1;
        const bound = recordLogBound(maxTicks, request.maxBytes ?? 256 << 10, request.maxDigests ?? Math.ceil(maxTicks / every));
        if (bound.bytes > logLimits.maxBytes || bound.nodes > logLimits.maxNodes) return refuse('log-limit');
      } else {
        if (typeof request.log !== 'string') return refuse('log');
        // Refuse unreadable, unsupported or corrupted logs before re-entering. openReplay checks byte, node and depth
        // limits before parsing; identity is checked at the visit, so any expectation will do here.
        const checked = openReplay(request.log, open, { build: '-', config: '-', step: 1 });
        if (checked.status === 'unsupported-version') return refuse('unsupported-version');
        if (checked.status === 'corrupt') return refuse(`corrupt-${checked.reason}`);
      }
      session?.stop('replaced');
      armed = { request: { ...request }, scene, open };
      const placeholder: Session = { mode: request.mode, status: 'armed', reason: null, scene, ticks: () => 0, total: null, log: () => null, digests: () => null, comparison: null,
        stop: reason => { armed = null; placeholder.status = 'stopped'; placeholder.reason = reason ?? 'stopped-before-arrival'; } };
      session = placeholder;
      return Object.freeze({ status: 'started', state: read() });
    },
    read,
    stop(reason) { session?.stop(reason ?? null); },
    dispose() { armed = null; restore(); },
  };

  function read(): ReplayDevState {
    const s = session;
    if (!s) return Object.freeze({ status: 'idle', mode: null, reason: null, scene: null, ticks: 0, total: null, log: null, digests: null, comparison: null });
    return Object.freeze({ status: s.status, mode: s.mode, reason: s.reason, scene: s.scene, ticks: s.ticks(), total: s.total,
      log: s.mode === 'record' ? s.log() : null, digests: s.digests(), comparison: s.comparison });
  }
}
