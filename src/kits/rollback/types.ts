/** Public types for the optional rollback kit. Pure data contracts; no transport, clock or scheduler. */

/** Configured bounds. Every peer in one session MUST use identical limits (compare `read().config`). */
export interface RollbackLimits {
  /** Participants, including the local one: an integer in [2, 8]. */
  readonly players: number;
  /** Frames that may be simulated past the last frame with every input confirmed: [0, 60]. 0 is lockstep. */
  readonly maxPredictionFrames: number;
  /** Frames between a local input and the frame it applies to: [0, 30]. Frames below it use `neutralInput`. */
  readonly inputDelay: number;
  /** UTF-8 bytes of one input text: [1, 4096]. */
  readonly maxInputBytes: number;
  /** UTF-8 bytes of one saved state text: [1, 16 MiB]. */
  readonly maxStateBytes: number;
  /** A confirmed checksum is recorded and published for frames that are a multiple of this: [1, 3600]. */
  readonly checksumInterval: number;
  /** Recorded confirmed checksums retained for comparison: [1, 4096]. Older reports are inconclusive. */
  readonly maxChecksumHistory: number;
  /** Remote checksum reports held until the local session confirms their frame: [1, 4096]. */
  readonly maxPendingChecksums: number;
}

/**
 * Creator code the session calls synchronously. Not sandboxed: it must be deterministic for its inputs, perform no
 * external effects in `step`, and keep every simulated fact inside what `save` returns and `load` restores.
 */
export interface RollbackPorts {
  /** The complete simulation state at the current frame boundary, as text in the creator's own codec. */
  save(): string;
  /** Replace the complete simulation state with a text that `save` returned earlier in this session. */
  load(state: string): void;
  /** Advance exactly one frame. `inputs[i]` is player i's input text (confirmed or predicted). */
  step(inputs: readonly string[], frame: number): void;
  /** Optional input schema check; only literal `true` admits an input. */
  validateInput?(input: string): boolean;
}

export interface RollbackOptions {
  /** This peer's player index in [0, players). */
  readonly local: number;
  /** The input every player has for frames below `inputDelay`, and the prediction before any remote input. */
  readonly neutralInput: string;
  readonly limits: RollbackLimits;
  readonly ports: RollbackPorts;
  /** Owner lifetime (for example a scene visit's signal): abort disposes the session. */
  readonly signal?: AbortSignal;
}

export type RollbackStatus = 'running' | 'desynced' | 'failed' | 'retired';
export type RollbackRefusal = Readonly<{status: 'busy' | 'failed' | 'desynced' | 'retired'; reason: string | null}>;
export type RollbackChecksum = Readonly<{frame: number; checksum: number}>;
export type RollbackDesync = Readonly<{frame: number; player: number; local: number; remote: number}>;

export type RollbackLocalResult =
  | Readonly<{status: 'queued'; frame: number; input: string}>
  | Readonly<{status: 'full' | 'invalid'; frame: number}>
  | RollbackRefusal;
export type RollbackRemoteResult =
  Readonly<{status: 'accepted' | 'duplicate'; rollbackFrom: number | null}> | RollbackRefusal;
export type RollbackChecksumResult =
  | Readonly<{status: 'match' | 'pending' | 'inconclusive'}>
  | Readonly<{status: 'desynced'; desync: RollbackDesync}>
  | RollbackRefusal;
export type RollbackAdvanceResult =
  | Readonly<{
      status: 'advanced';
      frame: number;
      resimulated: number;
      predicted: boolean;
      checksums: readonly RollbackChecksum[];
    }>
  | Readonly<{
      status: 'stalled';
      frame: number;
      resimulated: number;
      waitingFor: readonly number[];
      checksums: readonly RollbackChecksum[];
    }>
  | Readonly<{status: 'needs-local-input'; frame: number; resimulated: number; checksums: readonly RollbackChecksum[]}>
  /** `checksums` still lists what this call recorded, so the host can tell its peers before it stops. */
  | Readonly<{status: 'desynced'; desync: RollbackDesync; checksums: readonly RollbackChecksum[]}>
  | RollbackRefusal;

export interface RollbackStats {
  readonly advanced: number;
  readonly stalls: number;
  readonly rollbacks: number;
  readonly resimulated: number;
  readonly maxRollback: number;
  readonly steps: number;
  readonly saves: number;
  readonly loads: number;
}

export interface RollbackSnapshot {
  readonly status: RollbackStatus;
  readonly reason: string | null;
  /** Canonical limits text for a peer handshake; a mismatch means the peers cannot share a session. */
  readonly config: string;
  readonly local: number;
  /** The next frame `advance` will step. */
  readonly frame: number;
  /** Last frame with every player's input confirmed (-1 before any). */
  readonly confirmedFrame: number;
  /** Last confirmed input frame per player (the local entry is its queued frame). */
  readonly confirmedInputs: readonly number[];
  /** Frames already simulated with at least one predicted input. */
  readonly predictedFrames: number;
  /**
   * Per player: this peer's frame minus that peer's estimated frame (`confirmedInputs[p] - inputDelay`); 0 for the
   * local entry. Positive means this peer is ahead. The estimate lags by the one-way link delay, so it includes
   * latency; exchange it with peers and pace on the halved difference (see the recipe).
   */
  readonly frameAdvantage: readonly number[];
  readonly desync: RollbackDesync | null;
  readonly stats: RollbackStats;
}

export interface RollbackConfirmedState {
  /** The state at the start of `frame`, produced only from confirmed inputs. */
  readonly frame: number;
  readonly checksum: number;
  readonly state: string;
}

export interface RollbackSession {
  /** Queue this peer's input for `frame + inputDelay`. Send the returned `{frame, input}` to every peer. */
  local(input: string): RollbackLocalResult;
  /** Admit a peer's input. Frames must arrive contiguously per player (a reliable, ordered transport). */
  remote(player: number, frame: number, input: string): RollbackRemoteResult;
  /** Admit a peer's confirmed-state checksum report. */
  remoteChecksum(player: number, frame: number, checksum: number): RollbackChecksumResult;
  /** Call once per fixed tick: roll back and resimulate if needed, then step one frame unless stalled. */
  advance(): RollbackAdvanceResult;
  read(): RollbackSnapshot;
  /** The latest retained confirmed state, for resynchronization or diagnostics. */
  confirmedState(): RollbackConfirmedState | null;
  /** Immediate, idempotent, also from inside a port callback. */
  dispose(): void;
}

export interface SyncTestOptions {
  /** Frames rolled back and resimulated after every step: [1, 60]. */
  readonly checkDistance: number;
  readonly maxStateBytes: number;
  readonly maxInputBytes: number;
  /** Inputs per frame: [1, 8]. */
  readonly players: number;
  readonly ports: Pick<RollbackPorts, 'save' | 'load' | 'step'>;
  readonly signal?: AbortSignal;
}
export type SyncTestResult =
  | Readonly<{status: 'checked'; frame: number; resimulated: number}>
  | Readonly<{status: 'desynced'; frame: number; expected: number; actual: number}>
  | Readonly<{status: 'invalid'}>
  | RollbackRefusal;
export interface SyncTest {
  /** Step one frame with these inputs, then roll back `checkDistance` frames and compare resimulated checksums. */
  advance(inputs: readonly string[]): SyncTestResult;
  read(): Readonly<{
    status: RollbackStatus;
    reason: string | null;
    frame: number;
    desync: Readonly<{frame: number; expected: number; actual: number}> | null;
  }>;
  dispose(): void;
}
