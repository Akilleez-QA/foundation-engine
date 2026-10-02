import type { SceneModelRequest, SceneModelResult } from '../author/model-inspection';
/**
 * dev/test-api.ts: the typed test API, `window.engine` (ADR 0026, STD-TST-7). Scripts, playtests and browser tests
 * read state on demand through it, never from the DOM or from serialised attributes:
 *
 *   engine.ready()              resolves with the boot report
 *   engine.modules()            [{id, status, reason?}] from the boot report
 *   engine.probe(name)          one probe's current value (scene, world, game, save, input, audio, …)
 *   engine.probes()             every registered probe name
 *   engine.registry(name)       the frozen rows of one registry
 *   engine.state()              the playtest snapshot: scene, world (entities, resources, named entities), game
 *   engine.goto(scene, params?) navigate like a player would ('level' or 'scene.level'); resolves once active
 *   engine.teleport(x, z, name?) move a named entity (default 'player') in the running scene; false when there is none
 *   engine.key(key, ms?)        press a key (held for `ms`, default one tap) through the real input dispatcher
 *   engine.clock.hold()/step(ms)/resume()   freeze the one frame loop and step it deterministically
 *   engine.loop()               the loop's frame, update and render counters
 *   engine.events(fn)           tap every bus event (returns an unsubscribe)
 *   engine.save.export()        the active player's profile file
 *   engine.replay.start(request) re-enter the current scene recording or replaying its fixed-tick input (dev/replay.ts)
 *   engine.replay.read()/stop() the replay session's state, local log text and digest comparison
 *
 * Randomness is deterministic with `?seed=<n>` in the address (the game's `ctx.random()`).
 * It is added to the page only by the dev server and `vite build --mode test`; production builds never contain it.
 */
import type { SystemTimingOptions, SystemTimingCapture } from '../author/system-timing';
import type { App, BootReport } from '../core/app';
import type { SceneId } from '../core/router/resolve';
import type { ProbeName } from '../core/probe';
import { appLoop } from '../platform/ui/runtime';
import type {SceneEntitiesRequest, SceneEntitiesResult} from '../author/play';
import { createEventTrace, type EventTrace, type EventTraceOptions } from './event-trace';
import type { ReplayDev, ReplayDevRequest, ReplayDevState, ReplayStart } from './replay';

export interface EngineState {
  scene: { scene: string | null; state: string | null; epoch: number; hash: string } | undefined;
  world: unknown;
  game: unknown;
}

export interface EngineTestApi {
  ready(): Promise<BootReport>;
  modules(): { id: string; status: string; reason?: string }[];
  probe(name: string): unknown;
  probes(): string[];
  registry(name: string): readonly unknown[];
  state(): EngineState;
  /** Optional current-scene metadata page; never serializes component values. */
  entities(request: SceneEntitiesRequest): SceneEntitiesResult;
  model(request: SceneModelRequest): SceneModelResult;
  goto(scene: string, params?: Record<string, string>, timeoutMs?: number): Promise<{ scene: string; state: string }>;
  teleport(x: number, z: number, name?: string): boolean;
  key(key: string, ms?: number): Promise<void>;
  clock: { hold(): void; step(ms: number): void; resume(): void };
  /** The frame loop's counters: frames run, updates, renders and frames skipped (render on demand). */
  loop(): { frames: number; updates: number; renders: number; skipped: number };
  events(fn: (name: string, payload: unknown) => void): () => void;
  /** Start a bounded current-visit system capture; replaces that visit's capture and ends on visit abort. */
  systemTrace(options?: SystemTimingOptions): SystemTimingCapture | null;
  /** Start a bounded scalar capture; replaces this API instance's previous capture. Caller disposes when finished. */
  eventTrace(options?: EventTraceOptions): EventTrace;
  save: { export(): unknown };
  /** Record or replay the current scene's fixed-tick input from its next arrival (needs `?seed=`). Loaded on first use. */
  replay: {
    start(request: ReplayDevRequest, timeoutMs?: number): Promise<ReplayStart>;
    read(): ReplayDevState;
    stop(): void;
  };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const CODES: Record<string, string> = { ' ': 'Space', Enter: 'Enter', Escape: 'Escape', Tab: 'Tab' };
const codeOf = (key: string) => CODES[key] ?? (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^\d$/.test(key) ? `Digit${key}` : key);

export function createTestApi(app: App, booted: Promise<BootReport>): EngineTestApi {
  let trace: EventTrace | undefined;
  let replay: ReplayDev | undefined;
  const idle: ReplayDevState = Object.freeze({ status: 'idle', mode: null, reason: null, scene: null, ticks: 0, total: null, log: null, digests: null, comparison: null });
  const report = () => app.services.app.report();
  const probe = (name: string) => app.probes.read(name as ProbeName);
  const scene = () => probe('scene') as EngineState['scene'];
  return {
    ready: () => booted,
    modules: () => report().modules.map(m => ({ id: m.id, status: m.status, ...(m.reason ? { reason: m.reason } : {}) })),
    probe,
    probes: () => app.probes.names(),
    registry(name) {
      const r = (app.registries as unknown as Record<string, { all(): readonly unknown[] } | undefined>)[name];
      if (!r) throw Error(`engine.registry: no registry '${name}'`);
      return r.all();
    },
    state: () => ({ scene: scene(), world: probe('world'), game: probe('game') }),
    async goto(target, params, timeoutMs = 30000) {
      await booted;
      const id = (target.startsWith('scene.') ? target : `scene.${target}`) as SceneId;
      await app.services.router.go(id, params ? { params } : {});
      for (const t0 = performance.now(); ;) {
        const p = scene();
        if (p?.scene === id && p.state !== 'entering') return { scene: p.scene, state: p.state ?? '' };
        if (performance.now() - t0 > timeoutMs) throw Error(`engine.goto(${id}): not active after ${timeoutMs} ms (${JSON.stringify(p)})`);
        await sleep(50);
      }
    },
    entities(request) {
      const running = app.services.app.has('feature.game') ? app.services.play?.current() : null;
      return running?.entities?.(request) ?? {status: 'unavailable'};
    },
    model(request) {
      const running = app.services.app.has('feature.game') ? app.services.play?.current() : null;
      return running?.model?.(request) ?? {status: 'unavailable'};
    },
    teleport(x, z, name) {
      const running = app.services.app.has('feature.game') ? app.services.play.current() : null;
      return running ? running.teleport(x, z, name) : false;
    },
    async key(key, ms = 0) {
      const init = { key, code: codeOf(key), bubbles: true, cancelable: true };
      window.dispatchEvent(new KeyboardEvent('keydown', init));
      if (ms > 0) await sleep(ms);
      window.dispatchEvent(new KeyboardEvent('keyup', init));
    },
    clock: {
      hold: () => appLoop().holdFrames(true),
      step: ms => { for (let left = ms; left > 0; left -= 50) appLoop().stepFrame(Math.min(50, left) / 1000); },
      resume: () => appLoop().holdFrames(false),
    },
    loop: () => ({ ...appLoop().stats }),
    events: fn => app.events.tap((k, p) => fn(k, p)),
    systemTrace(options) {
      const running = app.services.app.has('feature.game') ? app.services.play?.current() : null;
      return running?.systemTrace?.(options) ?? null;
    },
    eventTrace(options) {
      const next = createEventTrace(app.events, options);
      trace?.dispose();
      trace = next;
      return next;
    },
    save: { export: () => app.services.save.exportPlayer() },
    replay: {
      async start(request, timeoutMs = 30000) {
        await booted;
        replay ??= (await import('./replay')).createReplayDev();
        const before = scene();
        if (!before?.scene || before.state === 'entering') return Object.freeze({ status: 'refused', reason: 'no-active-scene' }) as ReplayStart;
        const armed = replay.arm(request, before.scene.replace(/^scene\./, ''));
        if (armed.status !== 'started') return armed;
        await app.services.router.go(before.scene as SceneId, { again: 'reenter' });
        for (const t0 = performance.now(); ;) {
          const state = replay.read();
          // A visit-time refusal (seed, identity, scene) leaves that visit untapped: report it, not a start.
          if (state.status === 'refused' || state.status === 'failed') return Object.freeze({ status: 'refused', reason: state.reason ?? state.status });
          if (state.status !== 'armed') return Object.freeze({ status: 'started', state });
          if (performance.now() - t0 > timeoutMs) { replay.stop(); return Object.freeze({ status: 'refused', reason: 'arrival-timeout' }); }
          await sleep(20);
        }
      },
      read: () => replay?.read() ?? idle,
      stop: () => replay?.stop(),
    },
  };
}
