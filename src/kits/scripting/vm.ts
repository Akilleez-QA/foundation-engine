/**
 * Loading the script VM. The VM package and its WebAssembly binary are fetched only when a game calls
 * `loadScriptVm`, through dynamic imports, so a game that does not use scripts pays nothing for them.
 */
import type {ScriptVm} from './vm-contract';

export interface LoadScriptVmOptions {
  /** Abort while loading: the promise rejects with the signal's reason and the VM is not kept. */
  readonly signal?: AbortSignal;
  /** Replace how the VM is obtained (tests, a self-hosted binary, a different build of the same contract). */
  readonly load?: () => Promise<ScriptVm>;
}

let shared: Promise<ScriptVm> | null = null;

/** The default browser loader: the Lua VM module and its binary as a hashed build asset. */
async function loadDefault(): Promise<ScriptVm> {
  const [{createLuaVm}, url] = await Promise.all([import('./lua-vm'), import('./lua-wasm-url').then(m => m.default)]);
  return createLuaVm(url);
}

/**
 * The page's script VM, loaded once and shared by every host (each script still gets its own isolated state).
 * Call it from a scene's `prepare(ctx, signal)`. A failed load is not cached, so a later call retries.
 */
export function loadScriptVm(options: LoadScriptVmOptions = {}): Promise<ScriptVm> {
  const {signal, load} = options;
  if (signal?.aborted) return Promise.reject(signal.reason);
  const pending =
    load !== undefined
      ? load()
      : (shared ??= loadDefault().catch((e: unknown) => {
          shared = null;
          throw e;
        }));
  if (!signal) return pending;
  return new Promise<ScriptVm>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, {once: true});
    pending.then(
      vm => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) reject(signal.reason);
        else resolve(vm);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}
