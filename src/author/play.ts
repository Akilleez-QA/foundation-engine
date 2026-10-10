import type {SceneModelRequest, SceneModelResult} from './model-inspection';
/**
 * author/play.ts: the `play` service (owned by `feature.game`): the game's brief and identity, and a handle on the
 * running scene for the test API, probes and play:snap. A scene attaches its handle when it enters and it detaches
 * when the visit ends.
 */
import type {LightStats} from './light-slots';
import type {SystemTimingOptions, SystemTimingCapture} from './system-timing';
import type {EntityMetadataRequest, EntityMetadataPage} from '../core/ecs/world';
import type {BuildBrief} from './build';
import type {GameDefinition} from './defs';
import type {ParticleStats} from './particle-contract';
import type {ScenePostStats} from './scene-post';
import type {ScatterStats} from './scatter-field';
import type {ScatterEntry} from './scene-scatter';
import type {BlobShadowStats} from './scene-blob-shadows';

/** What a running scene reports and accepts from tools (the test API, probes, play scripts). */
export interface SceneHandle {
  /** Throws RESOURCE_CAPTURE_FAILED when resource JSON observation fails; later reads may recover. */
  state(): SceneState;
  /** Optional synchronous system capture, owned by this scene visit. */
  systemTrace?(options?: SystemTimingOptions): SystemTimingCapture | null;
  /** Optional metadata inspection; stock runtime supplies it only in dev/test builds. */
  entities?(request: SceneEntitiesRequest): SceneEntitiesResult;
  /** Optional on-demand adopted-model diagnostics, installed by stock dev/test runtime only. */
  model?(request: SceneModelRequest): SceneModelResult;
  /** Dev/test only: mark the picture dirty and ask for one frame (a real draw of an unchanged scene); false when the
   *  visit is ending. Render on demand stays on: nothing more is drawn until something changes. */
  redraw?(): boolean;
  /** Dev/test only: the visit's particle counters and the draws its emitters issue per frame (FX-01). */
  particles?(): ParticleStats & {
    draws: number;
    textures: {requested: number; leases: number; applied: number; failed: number};
  };
  /** Dev/test only: the visit's post-processing tier, readiness, targets and post draws (docs/guides/post-processing.md). */
  post?(): ScenePostStats;
  /** Dev/test only: each render extension's counters, by id (`{closed: true}` once it failed). */
  extensions?(): Record<string, Record<string, unknown>>;
  /** Dev/test only: the visit's scatter counters (admitted, copies, refusals, draws, triangles per scatter); null
   *  until the scatter drawing has loaded. Installed only in scenes that opted in with `sceneScatter()`. */
  scatter?(): (ScatterStats & {draws: number; triangles: number; list: ScatterEntry[]}) | null;
  /** Dev/test only: the visit's blob shadow counters (capacity, candidates, drawn, dropped, draws, uploads); null until
   *  the chunk has loaded. Installed only in scenes that opted in with `sceneBlobShadows()` (VIS-10). */
  blobShadows?(): BlobShadowStats | null;
  /** Dev/test only: the visit's local-light slots, admissions and refusals (VIS-02). */
  lights?(): LightStats;
  /** Move the entity with this `Name` (default 'player'): false when there is none. */
  teleport(x: number, z: number, name?: string): boolean;
}
export interface SceneEntitiesRequest extends EntityMetadataRequest {
  expectedEpoch: number;
}
export type SceneEntitiesResult =
  | {status: 'unavailable'}
  | {status: 'stale'; epoch: number}
  | {status: 'ready'; epoch: number; page: EntityMetadataPage};

export interface SceneState {
  scene: string;
  entities: number;
  /** The world's resources (score, lives, phase), as plain JSON. */
  state: Record<string, unknown>;
  /** Named entities and where they are. */
  named: Record<string, {x: number; y: number; z: number}>;
  frame: number;
}

export interface PlayService {
  readonly brief: BuildBrief;
  readonly game: GameDefinition;
  current(): SceneHandle | null;
  attach(handle: SceneHandle, signal: AbortSignal): void;
}

declare module '../core/services' {
  interface Services {
    readonly play: PlayService;
  }
}
declare module '../core/probe' {
  interface EngineProbes {
    game: {id: string; genre: string; policy: string; modes: readonly string[]; minimum: string};
    world: SceneState | null;
  }
}

export function createPlayService(brief: BuildBrief, game: GameDefinition): PlayService {
  let current: SceneHandle | null = null;
  return {
    brief,
    game,
    current: () => current,
    attach(handle, signal) {
      current = handle;
      signal.addEventListener(
        'abort',
        () => {
          if (current === handle) current = null;
        },
        {once: true},
      );
    },
  };
}
