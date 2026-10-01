/** Optional saved binding overrides, using the existing save and input owners. */
import type { SaveScope, SaveSection, SectionHandle, SectionStatus } from '../../core/save/section';
import { PAD_INPUTS, type ActionOverrides, type InputActions } from './actions';

export interface ControlsSettingsOptions {
  id: string;
  scope: SaveScope;
  /** Persisted UTF-16 character budget, including JSON structure. Default 65536. */
  maxChars?: number;
}

/** Unknown action ids survive absent content. Missing devices inherit defaults; [] deliberately unbinds. */
export function controlsSettingsSection(options: ControlsSettingsOptions): SaveSection<ActionOverrides> {
  const maxChars = options.maxChars ?? 65536;
  if (!Number.isSafeInteger(maxChars) || maxChars < 2) throw Error('controls maxChars must be a safe integer of at least 2');
  const parse = (raw: unknown): ActionOverrides => {
    const record = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === 'object' && !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
    if (!record(raw)) throw Error('controls overrides must be a record');
    const result: Record<string, { keys?: readonly string[]; pad?: readonly (typeof PAD_INPUTS)[number][] }> = Object.create(null);
    let remaining = maxChars - 2;
    for (const id of Object.keys(raw)) {
      if (!id || id.length > remaining) throw Error('controls action id or size is invalid');
      remaining -= id.length;
      const binding = raw[id];
      if (!record(binding) || Object.keys(binding).some(key => key !== 'keys' && key !== 'pad')) throw Error(`invalid controls binding for ${id}`);
      const copy: { keys?: readonly string[]; pad?: readonly (typeof PAD_INPUTS)[number][] } = {};
      for (const device of ['keys', 'pad'] as const) {
        if (!Object.hasOwn(binding, device)) continue;
        const values = binding[device];
        if (!Array.isArray(values) || values.length > remaining) throw Error(`invalid controls ${device} for ${id}`);
        const detached: string[] = [];
        for (const value of values) {
          if (typeof value !== 'string' || !value || value.length > remaining || /\s/.test(value) ||
              (device === 'pad' && !(PAD_INPUTS as readonly string[]).includes(value))) throw Error(`invalid controls ${device} for ${id}`);
          remaining -= value.length;
          detached.push(value);
        }
        if (device === 'keys') copy.keys = Object.freeze(detached);
        else copy.pad = Object.freeze(detached as (typeof PAD_INPUTS)[number][]);
      }
      result[id] = Object.freeze(copy);
    }
    if (JSON.stringify(result).length > maxChars) throw Error('controls overrides exceed maxChars');
    return Object.freeze(result);
  };
  return { id: options.id, scope: options.scope, version: 1, maxChars, initial: () => parse({}), parse };
}

export interface ControlsSettings {
  get(): ActionOverrides;
  /** Replaces saved overrides. Use get() to preserve unrelated or unknown actions. */
  set(value: ActionOverrides): SectionStatus;
  reset(): SectionStatus;
  status(): SectionStatus;
  dispose(): void;
}

export function bindControlsSettings(handle: SectionHandle<ActionOverrides>, input: Pick<InputActions, 'setOverrides'>,
  section: SaveSection<ActionOverrides>, signal?: AbortSignal): ControlsSettings {
  let disposed = signal?.aborted ?? false;
  const apply = (value: Readonly<ActionOverrides>) => { if (!disposed) input.setOverrides(section.parse(value)); };
  let off = () => {};
  const dispose = () => { if (disposed) return; disposed = true; off(); signal?.removeEventListener('abort', dispose); };
  if (!disposed) signal?.addEventListener('abort', dispose, { once: true });
  try {
    if (!disposed) {
      off = handle.subscribe(apply);
      if (disposed) off();
      else apply(handle.get());
    }
  } catch (error) { dispose(); throw error; }
  const set = (value: ActionOverrides) => {
    if (disposed) throw Error('controls settings disposed');
    return handle.replace(section.parse(value));
  };
  return {
    get: () => section.parse(handle.get()), set, reset: () => set({}), status: () => handle.status(), dispose,
  };
}
