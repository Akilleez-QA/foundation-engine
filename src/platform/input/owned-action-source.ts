import type { ActionId, DeviceFamily, InputActions } from './actions';

export interface OwnedActionSource {
  /** Physical pressed state, limited to the declared actions. Empty means neutral. */
  set(actions: readonly ActionId[]): void;
  dispose(): void;
}

/** Optional physical-edge adapter; accepted held actions and owner epochs remain in InputActions. */
export function ownActionSource(input: InputActions, actions: readonly ActionId[], device: DeviceFamily, signal?: AbortSignal): OwnedActionSource {
  const ids = [...new Set(actions)];
  const port = openActionSource(input, ids, device);
  let disposed = false, revision = 0;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener('abort', dispose);
    port.dispose();
  };
  signal?.addEventListener('abort', dispose, { once: true });
  if (signal?.aborted) dispose();
  return {
    set: desired => {
      if (disposed) return;
      const wanted = new Set(desired);
      for (const id of wanted) if (!ids.includes(id)) throw Error('action is not owned by this source');
      if (ids.every(id => wanted.has(id) === port.isDown(id))) return;
      const epoch = input.epoch, update = ++revision;
      for (const id of ids) {
        const down = wanted.has(id);
        if (down === port.isDown(id)) continue;
        if (!down) port.release(id);
        else port.press(id, epoch, () => !disposed && revision === update);
        if (disposed || revision !== update) return;
      }
    },
    dispose,
  };
}

/** Fixed-slot primitive for trusted platform integrations. Prefer ownActionSource for physical edges. */
export function openActionSource(input: InputActions, actions: readonly ActionId[], device: DeviceFamily): {
  isDown(action: ActionId): boolean;
  press(action: ActionId, epoch: number, valid?: () => boolean): void;
  release(action: ActionId): void;
  dispose(): void;
} {
  const bridge = input.sourceAccess();
  if (!Number.isSafeInteger(bridge.limit) || bridge.limit < 1) throw Error('maxOwnedSources must be a positive safe integer');
  const ids = [...new Set(actions)];
  const rows = ids.map(id => {
    const row = bridge.registry.find(id);
    if (!row || row.kind === 'axis') throw Error(`owned input source needs a registered press/hold action: ${id}`);
    return row;
  });
  const admission = bridge.admission;
  if (admission.count >= bridge.limit || !Number.isSafeInteger(admission.serial + 1)) throw Error('owned input source capacity exhausted');
  const serial = admission.serial + 1;
  const sources = rows.map((_, i) => `${device === 'touch' ? 'touch' : device === 'gamepad' ? 'pad' : 'key'}:owned:${serial}:${i}`);
  const revisions = sources.map(() => 0);
  const physical = new Set<number>();
  const slot = (id: ActionId) => {
    const index = ids.indexOf(id);
    if (index < 0) throw Error('action is not owned by this source');
    return index;
  };
  admission.serial = serial;
  admission.count++;
  let disposed = false;
  return {
    isDown: id => !disposed && physical.has(slot(id)),
    press: (id, epoch, valid = () => true) => {
      if (disposed) return;
      const index = slot(id), revision = revisions[index];
      if (physical.has(index)) return;
      physical.add(index);
      if (epoch !== input.epoch) return;
      bridge.press(rows[index], sources[index], device, () => !disposed && revisions[index] === revision && input.epoch === epoch && valid());
    },
    release: id => {
      if (disposed) return;
      const index = slot(id);
      revisions[index]++;
      physical.delete(index);
      bridge.release(sources[index]);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      physical.clear();
      admission.count--;
      const errors: unknown[] = [];
      for (const source of sources) {
        try { bridge.release(source); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'input source release failed');
    },
  };
}
