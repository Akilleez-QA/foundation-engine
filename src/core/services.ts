// core/services.ts: what install() receives. Owners add their service by augmentation, claim it in the manifest's
// `serviceKeys`, and provide it in install():
//   declare module '../../core/services' { interface Services { quality: Quality } }
//   defineModule({ id: 'platform.quality', serviceKeys: ['quality'], install(s) { s.provide('quality', createQuality()); } })
// Consumers read s.quality. There is no string-token lookup on the consumer side. D6, ADR 0043, 0063.
import type { EventBus } from './events';
import type { BehaviourRegistryName, ImplOf, Registries } from './registry';
import type { AppMode, Binding, BootReport, ModuleStatus } from './types';
import type { Probes } from './probe';

export type { Binding } from './types';

export interface Logger {
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

export interface AppInfo {
  readonly mode: AppMode;
  readonly build: { commit: string; builtAt: string; version: string };
  /** The boot report so far (complete after 'app.started'). */
  report(): BootReport;
  /** Is a module (or a module providing this virtual id) successfully installed? Discovery is not enough (ADR 0063).
   *  During install, an optional dependency's answer is final: it installs (or fails) before its dependants. */
  has(moduleId: string): boolean;
}

// ---- availability (ADR 0063) ----

export type AvailabilityResult = { available: true } | { available: false; reason: string };

export interface ModuleAvailability { id: string; status: ModuleStatus; reason?: string }

/** Kernel-owned, published once install settles, immutable afterwards. Definitions stay in the registries; this is
 *  the one executable-availability decision that router, prefetch, generated UI and `bind` share. */
export interface Availability {
  /** Is this row executable? Checks the row's source, the registry owner, the registry's declared executors, and
   *  the rows it requires. Aliases resolve. Throws if called before install settles. */
  forEntry<K extends keyof Registries & string>(registry: K, id: string): AvailabilityResult;
  /** Is this module (or a provider of this virtual id) installed? With the reason when it is not. */
  forModule(id: string): AvailabilityResult;
  /** Every discovered module's final status: the snapshot the boot report and the recovery shell read. */
  modules(): readonly ModuleAvailability[];
  readonly published: boolean;
}

// ---- lazy behaviour binding (ADR 0043) ----

export interface BoundSet<I> {
  /** Never throws: an id that was not requested reads as a placeholder. Synchronous; safe on a hot path. */
  get(id: string): Binding<I>;
  readonly bindings: readonly Binding<I>[];
  /** True when every requested id bound. */
  readonly valid: boolean;
}

export interface Services {
  /** Kernel-owned; read only at execution boundaries (ADR 0063). */
  readonly availability: Availability;
  readonly events: EventBus;
  readonly registries: Registries;
  /** Scoped to the calling module: messages carry its id. */
  readonly log: Logger;
  readonly app: AppInfo;
  /** Read-on-demand state for the test API and dev console. Kernel-owned: disabled in production
   *  builds without the test API, where `register` is one early return. */
  readonly probes: Probes;
  /** Aborted when this module is disposed (app teardown, or its install failed after subscribing). */
  readonly signal: AbortSignal;
  /** Provide a service this module owns and claimed in `serviceKeys`. Each key has exactly one provider. */
  provide<K extends ProvidedKey>(key: K, impl: Services[K]): void;
  /** Load and memoise the `impl` of each id at an async boundary, never per frame. Rejects only when `signal` aborts. */
  bind<K extends BehaviourRegistryName>(registry: K, ids: readonly string[], signal: AbortSignal): Promise<BoundSet<ImplOf<K>>>;
}

/** Keys only the kernel supplies; a manifest may not claim them. */
export const KERNEL_SERVICE_KEYS = Object.freeze(['availability', 'events', 'registries', 'log', 'app', 'probes', 'signal', 'provide', 'bind'] as const);
export type KernelServiceKey = typeof KERNEL_SERVICE_KEYS[number];

/** Keys a module may provide: everything except the kernel's own. */
export type ProvidedKey = Exclude<keyof Services, KernelServiceKey>;
