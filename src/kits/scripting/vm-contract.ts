/**
 * The narrow contract between the script host (pure TypeScript, always bundled with the kit) and a script VM (loaded
 * lazily). The host never imports the VM package; it only sees these shapes.
 */
import type {ScriptValue, ScriptValueLimits} from './values';

/** Why a run or call did not complete. `wall` and `memory` are safety stops, not deterministic outcomes. */
export type ScriptFailure = 'error' | 'instructions' | 'wall' | 'memory' | 'host-calls' | 'value';

/** Per-call budget. `clock` is read only to enforce `wallMs`; null disables the wall-time stop. */
export interface VmBudget {
  readonly instructions: number;
  readonly wallMs: number;
  readonly hostCalls: number;
  readonly clock: (() => number) | null;
}

export type VmOutcome =
  | {readonly ok: true; readonly value: ScriptValue; readonly instructions: number}
  | {readonly ok: false; readonly reason: ScriptFailure; readonly message: string; readonly instructions: number};

/** A host function as a script sees it: script values in, one script value (or nothing) out. Throw to raise a script
 *  error with the message. `cost` is charged to the call's instruction budget on every invocation. */
export interface VmHostFunction {
  readonly cost: number;
  readonly run: (args: readonly ScriptValue[]) => ScriptValue | undefined;
}

export interface VmStateOptions {
  readonly memoryBytes: number;
  readonly valueLimits: ScriptValueLimits;
  readonly allowPatterns: boolean;
  /** Global functions (the kit's built-ins). */
  readonly globals: Readonly<Record<string, VmHostFunction>>;
  /** Functions placed in the script's `host` table (the capabilities granted to this script). */
  readonly host: Readonly<Record<string, VmHostFunction>>;
  /** A float in [0, 1) from the script's own saveable stream (backs `math.random`). */
  readonly random: () => number;
}

export interface VmState {
  /** Set the global `name` to a value (raw; never runs script code). */
  write(name: string, value: ScriptValue): {readonly ok: true} | {readonly ok: false; readonly message: string};
  /** Read the global `name` as a script value (raw; never runs script code). */
  read(
    name: string,
    limits: ScriptValueLimits,
  ): {readonly ok: true; readonly value: ScriptValue} | {readonly ok: false; readonly message: string};
  /** Compile `source` as text (never binary chunks) and run its top level. */
  run(source: string, chunkName: string, budget: VmBudget): VmOutcome;
  /** Call the global function `fn` with `args`; `missing` when it is not a function. */
  call(
    fn: string,
    args: readonly ScriptValue[],
    budget: VmBudget,
  ): VmOutcome | {readonly ok: false; readonly reason: 'missing'};
  /** Bytes currently allocated by this state. */
  memoryUsed(): number;
  /** Free the state. Idempotent. */
  close(): void;
}

/** A loaded script VM: one per page; each script gets its own isolated state with its own memory cap. */
export interface ScriptVm {
  readonly language: 'lua-5.4';
  createState(options: VmStateOptions): VmState;
}
