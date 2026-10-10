/**
 * kits/save-generations: optional coherent multi-key saves over two alternating slots, on the existing storage port
 * (ADR 0116). One owner object per port and save writes and confirms each commit by reading it back (not a lock
 * across writers); no system, clock, store or registration is installed.
 * Cost: a commit verifies the newest generation twice (before writing and to confirm) and writes one generation, two
 * record operations and the sweep; load reads at most both generations. No per-frame work: call it from flush points, never inside a frame (STD-SAV-13).
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
