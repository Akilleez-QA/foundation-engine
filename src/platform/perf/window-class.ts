// platform/perf/window-class.ts (L1, pure): ADR 0053 workload classification of a bench window, and the
// ADR 0053 purpose of each texture upload inside it. Readiness and workload define a window; silence is a
// diagnostic. Nothing here drops a slow frame: recurring uploads and program work stay in the cost of play.

/** Bumped whenever the rules below change; part of the ADR 0046 cache key. */
export const CLASSIFICATION_VERSION = 1;

export type UploadPurpose = 'initial' | 'recurring' | 'firstUse' | 'unknown';
export type WindowKind = 'entry' | 'steady' | 'firstUse' | 'unclassified' | 'invalid';

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
}

export interface ClassifiedUpload extends UploadFact { purpose: UploadPurpose }

export interface WindowClassification {
  kind: WindowKind;
  version: number;
  reasons: string[];
  /** False for 'unclassified' and 'invalid': such a window never compares against a baseline as steady play. */
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
  if (f.renderedFrames === 0 && kind !== 'invalid') reasons.push('no rendered frame: counts are 0 by observation');
  return { classification: { kind, version: CLASSIFICATION_VERSION, reasons, comparable: kind !== 'invalid' && kind !== 'unclassified' }, uploads };
}
