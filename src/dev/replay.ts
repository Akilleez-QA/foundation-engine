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
  worldDigest, type DigestComparison, type DigestSnapshot, type OpenLimits,
} from '../kits/replay';

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
const LOG = Object.freeze({ maxBytes: 8 << 20, maxNodes: 1 << 20, maxDepth: 8 });
const MAX_TICKS = 1 << 20;
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
  stop: () => void;
}

export interface ReplayDev {
  /** Validate and arm a request for the next scene visit. The caller then re-enters the scene. */
  arm(request: ReplayDevRequest, scene: string): ReplayStart;
  read(): ReplayDevState;
  /** Stop the current session: recording ends (its log stays readable); a replay hands input back to the player. */
  stop(): void;
  dispose(): void;
}

export function createReplayDev(): ReplayDev {
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
    Object.assign(s, {
      ticks: () => tick, digests: () => trace.read(),
      log: () => (recorder.read().status === 'failed' ? null : recorder.export(trace.read())),
      stop: () => end('stopped', null),
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
    const every = recorded?.every ?? request.every ?? 1;
    const trace = createDigestTrace({ identity: sceneTraceIdentity(build, config, ctx.seed!), every,
      maxEntries: request.maxDigests ?? Math.max(1, Math.ceil(player.ticks / every)), maxDigestLength: 16 });
    const tap = createSceneInputTap(ctx.inputs, id => ctx.live.describe(id));
    let arrived = false, playing = true, tick = 0;
    const end = (status: ReplayDevStatus) => {
      if (!playing) return;
      playing = false; s.status = status;
      if (status === 'complete' && recorded) s.comparison = compareDigests(recorded, trace.read(), { through: player.ticks - 1 });
    };
    Object.assign(s, { total: player.ticks, ticks: () => tick, digests: () => trace.read(), stop: () => { end('stopped'); tap.passThrough(ctx.live); } });
    if (player.ticks === 0) end('complete');
    return {
      input: tap.input,
      // The lane holds before arrival and once the log is spent; ticks already due in that last frame keep the last
      // logged input and are not observed. After stop() the player's live input drives the lane again.
      running: () => arrived && (playing ? tick < player.ticks : s.status === 'stopped'),
      beforeTick() { if (playing) tap.load(player.input(tick)!); },
      afterTick() {
        if (!playing) return;
        if (trace.observe(tick, () => worldDigest(ctx.world)) === 'failed') { s.reason = trace.read().reason; end('failed'); return; }
        if (++tick >= player.ticks) end('complete');
      },
      arrive() { arrived = true; if (playing) s.status = 'replaying'; ctx.invalidate(); },
      retire() { if (playing) { s.reason = 'visit-ended'; end('stopped'); } },
    };
  }

  return {
    arm(request, scene) {
      if (!request || (request.mode !== 'record' && request.mode !== 'replay')) return refuse('mode');
      if (request.every !== undefined && !positive(request.every, MAX_TICKS)) return refuse('every');
      if (request.maxTicks !== undefined && !positive(request.maxTicks, MAX_TICKS)) return refuse('maxTicks');
      if (request.maxBytes !== undefined && !positive(request.maxBytes, LOG.maxBytes)) return refuse('maxBytes');
      if (request.maxDigests !== undefined && !positive(request.maxDigests, MAX_TICKS)) return refuse('maxDigests');
      const open: OpenLimits = { maxTicks: MAX_TICKS, maxBytes: LOG.maxBytes, input: INPUT, log: LOG, digests: { maxEntries: MAX_TICKS, maxDigestLength: 16 } };
      if (request.mode === 'replay') {
        if (typeof request.log !== 'string') return refuse('log');
        // Refuse unreadable, unsupported or corrupted logs before re-entering; identity is checked at the visit.
        let header: { build: string; config: string; step: number } = { build: '?', config: '?', step: 1 };
        try { header = (JSON.parse(request.log) as { header: typeof header }).header ?? header; } catch { /* openReplay reports it. */ }
        const checked = openReplay(request.log, open, header);
        if (checked.status === 'unsupported-version') return refuse('unsupported-version');
        if (checked.status === 'corrupt') return refuse(`corrupt-${checked.reason}`);
      }
      session?.stop();
      armed = { request: { ...request }, scene, open };
      session = { mode: request.mode, status: 'armed', reason: null, scene, ticks: () => 0, total: null, log: () => null, digests: () => null, comparison: null, stop: () => { armed = null; } };
      return Object.freeze({ status: 'started', state: read() });
    },
    read,
    stop() { session?.stop(); },
    dispose() { armed = null; restore(); },
  };

  function read(): ReplayDevState {
    const s = session;
    if (!s) return Object.freeze({ status: 'idle', mode: null, reason: null, scene: null, ticks: 0, total: null, log: null, digests: null, comparison: null });
    return Object.freeze({ status: s.status, mode: s.mode, reason: s.reason, scene: s.scene, ticks: s.ticks(), total: s.total,
      log: s.mode === 'record' ? s.log() : null, digests: s.digests(), comparison: s.comparison });
  }
}
