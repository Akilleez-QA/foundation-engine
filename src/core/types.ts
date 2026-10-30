// core/types.ts: the kernel shapes app.ts, module.ts and services.ts share (types only). Holding them here keeps the
// three files acyclic: services and module read the boot report and module status from here, never from app.ts.
// Each shape is re-exported from its contract home, so `import type { BootReport } from './app'`
// and `import type { ModuleReport } from './module'` keep working.
import type {BootPhase} from './events';
import type {RegistryProblem} from './registry';
import type {PatchReport} from './patch';

export type AppMode = 'dev' | 'test' | 'prod';

/** `candidate`: discovered and eligible, not yet installed (ADR 0063). `installed`: install completed.
 *  `disabled`: a dependency, conflict, claim, cycle or pack-validation problem kept it out. `failed`: it threw. */
export type ModuleStatus = 'candidate' | 'installed' | 'disabled' | 'failed';

export interface ModuleReport {
  id: string;
  version: string;
  status: ModuleStatus;
  /** The phase that failed, or where a dependency problem was found. */
  phase?: 'discover' | 'register' | 'patch' | 'validate' | 'install';
  reason?: string;
  /** register + install wall time. */
  ms: number;
  overBudget?: boolean;
}

/** One bound id. `placeholder`: no row, or the row is unavailable (ContractConfigurator's invalid factory).
 *  `failed`: the row's `impl.load()` rejected. Neither throws; the consumer shows "this helper isn't installed". */
export type Binding<I> =
  | {id: string; status: 'bound'; valid: true; impl: I}
  | {id: string; status: 'placeholder' | 'failed'; valid: false; reason: string};

export interface BindRecord {
  module: string;
  registry: string;
  id: string;
  status: Binding<unknown>['status'];
  reason?: string;
}

export interface BootReport {
  mode: AppMode;
  /** The phases that ran, in order. */
  phases: BootPhase[];
  /** Install order (dependencies first) of the modules that installed. */
  order: string[];
  modules: ModuleReport[];
  registries: {name: string; owner: string; count: number}[];
  problems: RegistryProblem[];
  patches: PatchReport;
  /** Wiring problems that did not stop boot: undeclared registry or service dependencies, budget overruns. */
  warnings: string[];
  /** The latest binding of each (module, registry, id): bound, placeholder or failed (ADR 0043 "bindings" view). */
  bindings: BindRecord[];
  /** Set when a foundational (`core.*`) module did not install: the shell must open recovery, saves untouched. */
  recovery?: {modules: string[]; reason: string};
  ms: number;
}
