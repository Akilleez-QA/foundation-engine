/**
 * kits/cells/culler.ts: applies a visible cell set to registered render targets. A target is visible when any of
 * its cells is visible. Only targets whose cells changed visibility are re-evaluated, and a target is written only
 * when its visibility actually flips; the write goes through a creator-chosen sink (three.js objects, ECS components
 * or the creator's own function).
 */
import type {ComponentType, Entity, World} from '../../author';
import type {CellViewResult} from './view';

/** How the culler writes visibility. `commit` runs once after an apply that wrote anything. */
export interface CellVisibilitySink<T> {
  set(target: T, visible: boolean): void;
  commit?(): void;
}

export interface CellCullerOptions<T> {
  /** Cells of the graph the view results come from. */
  readonly cellCount: number;
  /** Ceiling on registered targets, 1 to 1,048,576. */
  readonly maxObjects: number;
  /** Ceiling on cells per target (a target spanning a doorway lists both), 1 to 64. */
  readonly maxCellsPerObject: number;
  readonly sink: CellVisibilitySink<T>;
}

export interface CellCullStats {
  readonly objects: number;
  /** Targets last written visible. */
  readonly visibleObjects: number;
  /** Targets last written hidden. Targets not yet written by an apply are in neither count. */
  readonly culledObjects: number;
  readonly visibleCells: number;
  /** Targets written by the last apply. */
  readonly written: number;
}

export interface CellCuller<T> {
  /** Register a target in one or more cells; returns its handle, or -1 when `maxObjects` are registered. */
  add(target: T, cells: number | readonly number[]): number;
  /** Unregister. With `restore` (default true) a target the culler hid is shown again through the sink. */
  remove(handle: number, restore?: boolean): void;
  /** Apply a view result. Returns the number of targets written. */
  apply(result: CellViewResult): number;
  /** Re-evaluate every target on the next apply (after the creator changed visibility behind the culler's back). */
  resync(): void;
  stats(): CellCullStats;
  isVisible(handle: number): boolean;
  /** Terminal and idempotent. With `restore` (default true) every hidden target is shown again. */
  dispose(restore?: boolean): void;
}

export const OBJECT_CEILING = 1_048_576;

/** Writes `visible` on anything with a boolean `visible` field: three.js `Object3D`, a light, a sprite. */
export function objectVisibility<T extends {visible: boolean}>(after?: () => void): CellVisibilitySink<T> {
  return {
    set(target, visible) {
      target.visible = visible;
    },
    ...(after ? {commit: after} : {}),
  };
}

/**
 * Writes `visible` on an entity's component (`Shape`, `Mesh`, `Model`, `Scatter`, or a creator component with a
 * boolean `visible`) and marks the world changed once per apply so the renderer redraws. A despawned entity or a
 * missing component is skipped.
 */
export function entityVisibility(world: World, type: ComponentType<{visible: boolean}>): CellVisibilitySink<Entity> {
  return {
    set(entity, visible) {
      const data = world.get(entity, type);
      if (data) data.visible = visible;
    },
    commit: () => world.touch(),
  };
}

export function createCellCuller<T>(options: CellCullerOptions<T>): CellCuller<T> {
  if (!options || typeof options !== 'object') throw new TypeError('cells: culler options are required');
  const {cellCount: n, maxObjects, maxCellsPerObject: per, sink} = options;
  if (!Number.isSafeInteger(n) || n < 1 || n > 65_536) throw new RangeError('cells: cellCount must be in [1, 65536]');
  if (!Number.isSafeInteger(maxObjects) || maxObjects < 1 || maxObjects > OBJECT_CEILING)
    throw new RangeError(`cells: maxObjects must be an integer in [1, ${OBJECT_CEILING}]`);
  if (!Number.isSafeInteger(per) || per < 1 || per > 64)
    throw new RangeError('cells: maxCellsPerObject must be an integer in [1, 64]');
  if (!sink || typeof sink.set !== 'function') throw new TypeError('cells: a sink with set() is required');
  if (sink.commit !== undefined && typeof sink.commit !== 'function')
    throw new TypeError('cells: commit must be a function');
  // Membership slots: slot = handle * per + k, linked per cell.
  const slots = maxObjects * per;
  const slotCell = new Int32Array(slots).fill(-1),
    next = new Int32Array(slots).fill(-1),
    prevSlot = new Int32Array(slots).fill(-1),
    head = new Int32Array(n).fill(-1);
  const targets: (T | undefined)[] = new Array(maxObjects).fill(undefined);
  const live = new Uint8Array(maxObjects);
  /** 0 never written, 1 shown, 2 hidden. */
  const state = new Uint8Array(maxObjects);
  const want = new Uint8Array(maxObjects);
  const mark = new Uint8Array(maxObjects);
  const touched = new Int32Array(maxObjects);
  const cellOn = new Uint8Array(n);
  const freeList: number[] = [];
  let top = 0,
    objects = 0,
    visibleObjects = 0,
    hiddenObjects = 0,
    visibleCells = 0,
    written = 0,
    full = true,
    busy = false,
    disposed = false;
  const guard = (): void => {
    if (disposed) throw new Error('cells: culler is disposed');
    if (busy) throw new Error('cells: culler is busy (reentrant call from a sink)');
  };
  const liveHandle = (h: number): number => {
    if (!Number.isSafeInteger(h) || h < 0 || h >= maxObjects || !live[h]) throw new RangeError(`cells: no target ${h}`);
    return h;
  };
  const shownNow = (h: number): boolean => {
    for (let k = 0; k < per; k++) {
      const c = slotCell[h * per + k]!;
      if (c >= 0 && cellOn[c]) return true;
    }
    return false;
  };
  const write = (h: number, visible: boolean): void => {
    const before = state[h]!;
    if (before === 1) visibleObjects--;
    else if (before === 2) hiddenObjects--;
    // Unknown until the sink returns: a throwing sink leaves the target to be written again by a later apply.
    state[h] = 0;
    sink.set(targets[h] as T, visible);
    state[h] = visible ? 1 : 2;
    if (visible) visibleObjects++;
    else hiddenObjects++;
    written++;
  };

  return {
    add(target, cells) {
      guard();
      const list = typeof cells === 'number' ? [cells] : cells;
      if (!Array.isArray(list) || list.length < 1 || list.length > per)
        throw new RangeError(`cells: a target needs 1 to ${per} cells`);
      for (const c of list)
        if (!Number.isSafeInteger(c) || c < 0 || c >= n) throw new RangeError(`cells: no cell ${c}`);
      if (new Set(list).size !== list.length) throw new RangeError('cells: a target lists a cell twice');
      const h = freeList.length ? freeList.pop()! : top < maxObjects ? top++ : -1;
      if (h < 0) return -1;
      live[h] = 1;
      targets[h] = target;
      state[h] = 0;
      objects++;
      for (let k = 0; k < list.length; k++) {
        const s = h * per + k,
          c = list[k]!;
        slotCell[s] = c;
        prevSlot[s] = -1;
        next[s] = head[c]!;
        if (head[c]! >= 0) prevSlot[head[c]!] = s;
        head[c] = s;
      }
      // Written on the next apply, even when the camera has not moved.
      full = true;
      return h;
    },
    remove(handle, restore = true) {
      guard();
      const h = liveHandle(handle);
      if (restore && state[h] === 2) {
        busy = true;
        try {
          sink.set(targets[h] as T, true);
          sink.commit?.();
        } finally {
          busy = false;
        }
      }
      if (state[h] === 1) visibleObjects--;
      else if (state[h] === 2) hiddenObjects--;
      for (let k = 0; k < per; k++) {
        const s = h * per + k,
          c = slotCell[s]!;
        if (c < 0) continue;
        if (prevSlot[s]! >= 0) next[prevSlot[s]!] = next[s]!;
        else head[c] = next[s]!;
        if (next[s]! >= 0) prevSlot[next[s]!] = prevSlot[s]!;
        slotCell[s] = -1;
        next[s] = -1;
        prevSlot[s] = -1;
      }
      live[h] = 0;
      state[h] = 0;
      targets[h] = undefined;
      objects--;
      freeList.push(h);
    },
    apply(result) {
      guard();
      if (!result || !(result.visible instanceof Uint8Array) || result.visible.length !== n)
        throw new TypeError('cells: result must come from a view of a graph with cellCount cells');
      busy = true;
      written = 0;
      let count = 0;
      try {
        if (full) {
          cellOn.set(result.visible);
          visibleCells = 0;
          for (let c = 0; c < n; c++) visibleCells += cellOn[c]!;
          for (let h = 0; h < top; h++) if (live[h]) touched[count++] = h;
        } else {
          for (let c = 0; c < n; c++) {
            const on = result.visible[c]!;
            if (on === cellOn[c]) continue;
            cellOn[c] = on;
            visibleCells += on ? 1 : -1;
            for (let s = head[c]!; s >= 0; s = next[s]!) {
              const h = (s / per) | 0;
              if (!mark[h]) {
                mark[h] = 1;
                touched[count++] = h;
              }
            }
          }
        }
        full = false;
        for (let i = 0; i < count; i++) {
          const h = touched[i]!;
          mark[h] = 0;
          want[h] = shownNow(h) ? 1 : 2;
        }
        for (let i = 0; i < count; i++) {
          const h = touched[i]!;
          if (want[h] !== state[h]) write(h, want[h] === 1);
        }
        if (written > 0) sink.commit?.();
      } catch (error) {
        // Recovery: forget the incremental baseline; the next apply re-evaluates every target.
        for (let i = 0; i < count; i++) mark[touched[i]!] = 0;
        full = true;
        throw error;
      } finally {
        busy = false;
      }
      return written;
    },
    resync() {
      guard();
      for (let h = 0; h < top; h++) state[h] = 0;
      visibleObjects = 0;
      hiddenObjects = 0;
      full = true;
    },
    stats: () => ({
      objects,
      visibleObjects,
      culledObjects: hiddenObjects,
      visibleCells,
      written,
    }),
    isVisible: h => state[liveHandle(h)] !== 2,
    dispose(restore = true) {
      if (disposed) return;
      if (busy) throw new Error('cells: culler is busy (reentrant call from a sink)');
      disposed = true;
      if (!restore) return;
      let any = false;
      busy = true;
      try {
        for (let h = 0; h < top; h++)
          if (live[h] && state[h] === 2) {
            sink.set(targets[h] as T, true);
            any = true;
          }
        if (any) sink.commit?.();
      } finally {
        busy = false;
        targets.fill(undefined);
      }
    },
  };
}
