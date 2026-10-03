// platform/perf/window-class.ts (L1, pure): ADR 0053 workload classification of a bench window, and the
// ADR 0053 purpose of each texture upload inside it. Readiness and workload define a window; silence is a
// diagnostic. Nothing here drops a slow frame: recurring uploads and program work stay in the cost of play.

/** Bumped whenever the rules below change; part of the ADR 0046 cache key. */
export const CLASSIFICATION_VERSION = 3;

export type UploadPurpose = 'initial' | 'recurring' | 'firstUse' | 'unknown';
/**
 * 'inconclusive': the window ran and was guarded, but what it observed cannot stand for the scene: an active window
 * whose held keys drive the scene (they press a game action, or the scene row names them as its `activeKeys`) yet
 * rendered no frame. The scene most likely ended (the player lost, the run froze, a pause), so its per-frame counts
 * are 0 by observation, not a measurement of play. Never comparable; never a budget source. An active window whose
 * held keys press nothing in the game is a still window, like an idle one (render on demand draws nothing).
 */
export type WindowKind = 'entry' | 'steady' | 'firstUse' | 'unclassified' | 'invalid' | 'inconclusive';

/** One texture's uploads in a window, as the probe records them. */
export interface UploadFact {
  /** The probe's id for the GL texture object. */
  resource: number;
  bytes: number;
  /** Frame index within the window of this texture's first upload in the window. */
  frame: number;
  /** True when this texture object had never been uploaded before this window. */
  firstEver: boolean;
  /** Uploads of this texture in the window (1 for most first uses). */
  count: number;
}

export interface WindowFacts {
  mode: 'idle' | 'active';
  /** null when the scene guard held; else why the window is not in the scene's current epoch. */
  epochBreak: string | null;
  contextLost: boolean;
  /** rAF ticks seen, and frames that drew. */
  frames: number;
  renderedFrames: number;
  /** The window ran to its full length (the frame target, or the time cap with the page ticking). */
  complete: boolean;
  /** Network requests in flight at the start of the window, and requests started during it. */
  pendingAtStart: number;
  requestsDuring: number;
  uploads: readonly UploadFact[];
  programsCreated: number;
  /**
   * Active windows only: whether the held keys drive the scene. true when they press one of the game's own input
   * actions (game or kit rows) or the scene row declares them as its `activeKeys`; false when they press none, so
   * holding them cannot change the picture; undefined when unknown (treated as true: a dead window is never excused).
   */
  heldKeysDrive?: boolean;
}

export interface ClassifiedUpload extends UploadFact { purpose: UploadPurpose }

export interface WindowClassification {
  kind: WindowKind;
  version: number;
  reasons: string[];
  /** False for 'unclassified', 'inconclusive' and 'invalid': such a window never compares against a baseline as steady play. */
  comparable: boolean;
}

/**
 * The purpose follows the resource's actual lifecycle, never a convenient label:
 * - a texture uploaded before this window and again in it is **recurring** (a board redrawn each .25 s);
 * - a new texture while the scene's own loading is unfinished is **initial**;
 * - a new texture met on the active script's route is **firstUse**;
 * - a new texture in a still window after loading finished is **unknown**: nobody has attributed it.
 */
export function uploadPurpose(u: UploadFact, f: Pick<WindowFacts, 'mode' | 'pendingAtStart' | 'requestsDuring'>): UploadPurpose {
  if (!u.firstEver) return 'recurring';
  if (f.pendingAtStart > 0 || f.requestsDuring > 0) return 'initial';
  return f.mode === 'active' ? 'firstUse' : 'unknown';
}

/** The reason an active window that drew nothing is 'inconclusive' (shared by the bench, the gate and perf:derive). */
export const NO_FRAME_ACTIVE = 'active window rendered no frame while input was held: the scene probably ended (game over, frozen run or pause), so its counts are 0 by observation, not measured';
/** The reason an active window that drew nothing is still valid: its held keys press nothing the game binds. */
export const NO_FRAME_UNDRIVEN = 'active window rendered no frame, but the held keys press no game action: a still window (render on demand), counts are 0 by observation';

export function classifyWindow(f: WindowFacts): { classification: WindowClassification; uploads: ClassifiedUpload[] } {
  const uploads = f.uploads.map(u => ({ ...u, purpose: uploadPurpose(u, f) }));
  const count = (p: UploadPurpose) => uploads.filter(u => u.purpose === p).length;
  const reasons: string[] = [];
  let kind: WindowKind;
  if (f.epochBreak !== null || f.contextLost || !f.complete || f.frames < 2) {
    if (f.epochBreak !== null) reasons.push('epoch: ' + f.epochBreak);
    if (f.contextLost) reasons.push('context lost');
    if (!f.complete || f.frames < 2) reasons.push(`incomplete: ${f.frames} frames, ${f.renderedFrames} rendered`);
    kind = 'invalid';
  } else if (f.pendingAtStart > 0 || count('initial') > 0) {
    if (f.pendingAtStart > 0) reasons.push(`${f.pendingAtStart} request(s) in flight at the start`);
    if (count('initial')) reasons.push(`${count('initial')} initial upload(s)`);
    kind = 'entry';
  } else if (count('unknown') > 0) {
    reasons.push(`${count('unknown')} upload(s) of unknown provenance`);
    kind = 'unclassified';
  } else if (count('firstUse') > 0 || f.programsCreated > 0) {
    if (count('firstUse')) reasons.push(`${count('firstUse')} first-use upload(s)`);
    if (f.programsCreated) reasons.push(`${f.programsCreated} program(s) created`);
    kind = 'firstUse';
  } else {
    if (count('recurring')) reasons.push(`${count('recurring')} recurring upload(s) kept in the cost`);
    kind = 'steady';
  }
  // A still idle window that renders nothing is the on-demand renderer doing its job. An active window whose held keys
  // drive the scene should draw; one that drew nothing has stopped (game over, frozen run, pause) and measured nothing.
  // Keys that press no game action cannot move anything, so that window is still, exactly like an idle one.
  if (f.renderedFrames === 0 && kind !== 'invalid' && f.mode === 'active' && f.heldKeysDrive !== false) {
    reasons.push(NO_FRAME_ACTIVE);
    kind = 'inconclusive';
  } else if (f.renderedFrames === 0 && kind !== 'invalid') reasons.push(f.mode === 'active' ? NO_FRAME_UNDRIVEN : 'no rendered frame: counts are 0 by observation');
  return { classification: { kind, version: CLASSIFICATION_VERSION, reasons, comparable: kind !== 'invalid' && kind !== 'unclassified' && kind !== 'inconclusive' }, uploads };
}
