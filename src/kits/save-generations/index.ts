/**
 * kits/save-generations: optional coherent multi-key saves over two alternating slots, on the existing storage port
 * (ADR 0116). One owner object per save is the only writer; no system, clock, store or registration is installed.
 * Cost: a commit verifies the newest generation and writes one generation plus two record operations; load reads at
 * most both generations. No per-frame work: call it from flush points, never inside a frame (STD-SAV-13).
 */
export {
  createSaveGenerations,
  GENERATION_CEILING,
  type CommitOptions,
  type CommitResult,
  type CommitStatus,
  type GenerationLimits,
  type GenerationPort,
  type GenerationSlot,
  type GenerationSnapshot,
  type LoadResult,
  type LoadStatus,
  type SaveGenerations,
  type SaveGenerationsOptions,
  type SlotReport,
  type SlotState,
} from './generations';
