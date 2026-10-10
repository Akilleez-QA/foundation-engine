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
  /** Optional: agreed input-delay changes (absent: the delay stays `limits.inputDelay`). */
  readonly adaptiveDelay?: RollbackDelayPolicy;
  /** Optional: departure agreement (absent: `disconnect` and `remoteDeparture` refuse with `unsupported`). */
  readonly departure?: RollbackDeparturePolicy;
  /** Optional: input frames kept below the current frame for relays and spectators, [0, 3600] (default 0). */
  readonly retainInputFrames?: number;
  /** Optional: start (resume or join) from an agreed saved state instead of the creator's frame-0 state. */
  readonly start?: RollbackStart;
  /** Optional: keep per-frame desync evidence for recent checksum frames. */
  readonly evidence?: RollbackEvidencePolicy;
}

/** Bounds for agreed input-delay changes. Every peer must use the same policy (it is part of `read().config`). */
export interface RollbackDelayPolicy {
  /** Smallest and largest delay, [0, 30]; `limits.inputDelay` must lie between them. */
  readonly minDelay: number;
  readonly maxDelay: number;
  /** Largest change per decision, [1, 30]. */
  readonly maxStep: number;
  /** Fewest frames between two decisions' effective frames, [maxStep + 1, 3600]. */
  readonly minSpacing: number;
  /** The only player whose decisions are accepted. If it departs, the delay stays as last decided. */
  readonly authority: number;
}
/** A delay decision: input frames from `from` onward apply `delay` frames after the tick that queued them. */
export type RollbackDelayChange = Readonly<{delay: number; from: number}>;

/** What a departed player's input is for frames after the agreed last frame. */
export interface RollbackDeparturePolicy {
  readonly input: 'neutral' | 'repeat';
  /**
   * Players (including this one) that must remain, neither leaving nor departed, before this peer decides a
   * departure; [1, players], default a strict majority. Below it the departure stays undecided and the session stalls.
   * With a strict majority two disjoint groups cannot both decide; a lower quorum (two players need 1) gives no
   * protection against a partition.
   */
  readonly quorum?: number;
}
/** One departing player's agreement state. `reports` are `[reporter, lastFrame]`; `decided` is the agreed last frame. */
export type RollbackDeparture = Readonly<{
  player: number;
  reports: readonly (readonly [number, number])[];
  decided: number | null;
  /** True once this peer holds every input through `decided` and the player's later input is fixed. */
  final: boolean;
  /** The fixed input for frames after `decided` (null until final). */
  input: string | null;
}>;

export interface RollbackStart {
  /** The first frame this session steps; frames below `frame + inputDelay` use the neutral input. */
  readonly frame: number;
  /** A text the creator's `save` returned at the start of `frame` (for example from `confirmedState()`). */
  readonly state: string;
  /** `rollbackChecksum(state)`; a mismatch refuses construction. */
  readonly checksum: number;
}

export interface RollbackEvidencePolicy {
  /** Checksum frames whose state text is retained for evidence, [1, 64]. */
  readonly frames: number;
  /** Largest evidence text in UTF-8 bytes, [64, 1 MiB]; longer text is truncated and marked. */
  readonly maxBytes: number;
  /** Largest chunk text in UTF-8 bytes, [64, 65536]. */
  readonly chunkBytes: number;
  /** Optional creator digest or trace text for a retained state (default: the state text itself). */
  describe?(state: string, frame: number): string;
}
export type RollbackEvidenceChunk = Readonly<{
  frame: number;
  checksum: number;
  index: number;
  count: number;
  truncated: boolean;
  text: string;
}>;
export type RollbackEvidence =
  | Readonly<{
      status: 'ready';
      frame: number;
      checksum: number;
      truncated: boolean;
      chunks: readonly RollbackEvidenceChunk[];
    }>
  | Readonly<{status: 'unavailable'; frame: number; reason: 'not-retained' | 'describe-failed' | 'disabled'}>;

/** A confirmed input with any delay decision attached to it, as relayed between peers. */
export type RollbackWireInput = Readonly<{player: number; frame: number; input: string; delay?: RollbackDelayChange}>;
export type RollbackHistoryResult =
  | Readonly<{status: 'ok'; entries: readonly RollbackWireInput[]}>
  | Readonly<{status: 'pruned'; oldest: number}>
  | RollbackRefusal;

export type RollbackStatus = 'running' | 'desynced' | 'failed' | 'retired';
export type RollbackRefusal = Readonly<{status: 'busy' | 'failed' | 'desynced' | 'retired'; reason: string | null}>;
export type RollbackChecksum = Readonly<{frame: number; checksum: number}>;
export type RollbackDesync = Readonly<{frame: number; player: number; local: number; remote: number}>;

export type RollbackLocalResult =
  /**
   * `through` (present only when above `frame`): a delay increase filled frames `frame..through` with this input.
   * `delay`: a decision of this peer (the delay authority) attached to frame `through ?? frame`; send it with it.
   */
  | Readonly<{status: 'queued'; frame: number; input: string; through?: number; delay?: RollbackDelayChange}>
  | Readonly<{status: 'full' | 'invalid'; frame: number}>
  | RollbackRefusal;
/** `ignored`: an input of a departing player beyond the frame this peer may still accept. */
export type RollbackRemoteResult =
  Readonly<{status: 'accepted' | 'duplicate' | 'ignored'; rollbackFrom: number | null}> | RollbackRefusal;
export type RollbackDelayResult =
  | Readonly<{status: 'pending'; delay: number}>
  | Readonly<{
      status: 'invalid';
      reason: 'not-authority' | 'disabled' | 'range' | 'step' | 'unchanged' | 'busy-proposal';
    }>
  | RollbackRefusal;
export type RollbackDepartureResult =
  | Readonly<{status: 'leaving' | 'departed'; decided: number | null}>
  | Readonly<{status: 'ignored'}>
  | Readonly<{status: 'unsupported'}>
  | RollbackRefusal;
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
  /** The delay for the next local input frame, and every agreed change (oldest first, at most a few). */
  readonly delay: number;
  readonly delayChanges: readonly RollbackDelayChange[];
  /** Departing and departed players. */
  readonly departures: readonly RollbackDeparture[];
  /** The start frame (0 unless resumed); checksum reports below it are inconclusive. */
  readonly startFrame: number;
  /** Input frames retained below the current frame (relay window). */
  readonly retainedInputFrames: number;
  /** The largest frame lead a peer with identical limits can legitimately have (bounds reported advantages). */
  readonly maxLead: number;
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
  /**
   * Admit a peer's input. Frames must arrive contiguously per player (a reliable, ordered transport, or the exchange
   * helper over a lossy one). `delay` is a decision the delay authority attached to this input frame.
   */
  remote(player: number, frame: number, input: string, delay?: RollbackDelayChange): RollbackRemoteResult;
  /** Admit a peer's confirmed-state checksum report. */
  remoteChecksum(player: number, frame: number, checksum: number): RollbackChecksumResult;
  /** Call once per fixed tick: roll back and resimulate if needed, then step one frame unless stalled. */
  advance(): RollbackAdvanceResult;
  read(): RollbackSnapshot;
  /** The latest retained confirmed state, for resynchronization or diagnostics. */
  confirmedState(): RollbackConfirmedState | null;
  /** Immediate, idempotent, also from inside a port callback. */
  dispose(): void;
  /** Authority only: decide a new delay; it is attached to the next queued local input. */
  proposeDelay(delay: number): RollbackDelayResult;
  /** This peer's transport says `player` left or timed out: start the departure agreement. */
  disconnect(player: number): RollbackDepartureResult;
  /** A survivor's departure reports (gossip) and decision for `player`. */
  remoteDeparture(
    from: number,
    player: number,
    reports: readonly (readonly [number, number])[],
    decided: number | null,
  ): RollbackDepartureResult;
  /** Retained confirmed inputs of `player` from `from`, at most `max`, for relays and spectators. */
  history(player: number, from: number, max: number): RollbackHistoryResult;
  /** The newest recorded confirmed checksums, at most `max`, oldest first. */
  recentChecksums(max: number): readonly RollbackChecksum[];
  /** Evidence text chunks for a retained checksum frame (default: the desync frame). */
  evidence(frame?: number): RollbackEvidence;
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
