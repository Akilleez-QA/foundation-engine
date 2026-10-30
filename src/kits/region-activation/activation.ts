/**
 * kits/region-activation/activation.ts: which regions of a large world are simulated, from observer positions.
 *
 * A uniform grid of rectangular regions covers the creator's plane. Observers (players, cameras, sensors) activate
 * dormant regions near them and keep active regions alive while they stay within a wider release radius. A region
 * that nobody keeps lingers for a configured number of updates (an observer returning cancels the release), then
 * becomes dormant. Pins keep a chosen region active without observers, subject to `maxActive`. Each `update` applies
 * a bounded number of activations (pins, then nearest first) and deactivations (longest unkept first), and reports
 * the rest as deferred.
 *
 * The caller owns what a region means: which entities it ticks, what it loads or saves on a transition, how a
 * dormant region catches up (`dormantFor`), and when to call `update`. Nothing here schedules, loads, saves, calls
 * back or touches the ECS. All tables are allocated at construction; a steady-state `update` allocates nothing.
 */

export interface RegionActivationLimits {
  /** Region edge length in world units. Finite, > 0. */
  readonly cellSize: number;
  /** Inclusive world rectangle the regions cover. Finite; max > min. */
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /** Most regions (columns x rows must fit). Positive safe integer <= REGION_CEILING.regions. */
  readonly maxRegions: number;
  /** A dormant region activates when an observer is within this distance of its rectangle. Finite, >= 0. */
  readonly activateRadius: number;
  /** An active region stays active while an observer is within this distance. Finite, >= activateRadius. */
  readonly releaseRadius: number;
  /** Updates an unkept region stays active (lingering) before it may deactivate. Safe integer 0..1,000,000. */
  readonly lingerUpdates: number;
  /** Most observers. */
  readonly maxObservers: number;
  /** Most simultaneously active (or lingering) regions; activations beyond it are refused as `saturated`. */
  readonly maxActive: number;
  /** Most live pins. */
  readonly maxPins: number;
  /** Most activations applied per update; the rest wait (nearest first). <= maxActive. */
  readonly maxActivationsPerUpdate: number;
  /** Most deactivations applied per update; the rest stay active and lingering. <= maxActive. */
  readonly maxDeactivationsPerUpdate: number;
  /** Most regions one observer's release-radius scan may touch; construction refuses a radius that could exceed it. */
  readonly maxCellsPerObserver: number;
}

/** Hard ceilings of this implementation (eager typed-array allocation). */
export const REGION_CEILING = Object.freeze({
  regions: 1 << 22,
  observers: 1 << 16,
  pins: 1 << 20,
  cellsPerObserver: 1 << 16,
  lingerUpdates: 1_000_000,
});

/**
 * - `complete`: every wanted activation and due deactivation was applied.
 * - `deferred`: a per-update budget postponed some transitions; they are reconsidered next update.
 * - `saturated`: `maxActive` refused at least one wanted activation (takes precedence over `deferred`).
 * - `closed`: the activation owner was disposed; nothing changed.
 */
export type RegionUpdateStatus = 'complete' | 'deferred' | 'saturated' | 'closed';
export type RegionState = 'dormant' | 'active' | 'lingering';

/** A reusable result record from {@link createRegionUpdateResult}. Buffers are overwritten by each update. */
export interface RegionUpdateResult {
  status: RegionUpdateStatus;
  /** Regions activated by this update, nearest observer first (pins first), ties by ascending index. */
  readonly activated: Int32Array;
  /** For each activated region: updates since it last deactivated, or -1 if it was never active. */
  readonly dormantFor: Float64Array;
  activatedCount: number;
  /** Regions deactivated by this update, longest unkept first, ties by ascending index. */
  readonly deactivated: Int32Array;
  deactivatedCount: number;
  /** Wanted activations not applied (budget or `maxActive`). */
  deferredActivations: number;
  /** Due deactivations not applied (budget); those regions remain active and lingering. */
  deferredDeactivations: number;
  /** This update's ordinal (1 for the first update); 0 when closed. */
  update: number;
}

export function createRegionUpdateResult(
  limits: Pick<RegionActivationLimits, 'maxActivationsPerUpdate' | 'maxDeactivationsPerUpdate'>,
): RegionUpdateResult {
  const a = limits.maxActivationsPerUpdate,
    d = limits.maxDeactivationsPerUpdate;
  if (!count(a) || !count(d))
    throw new RangeError('region activation result: per-update limits must be positive safe integers');
  return {
    status: 'complete',
    activated: new Int32Array(a),
    dormantFor: new Float64Array(a),
    activatedCount: 0,
    deactivated: new Int32Array(d),
    deactivatedCount: 0,
    deferredActivations: 0,
    deferredDeactivations: 0,
    update: 0,
  };
}

/** An opaque pin. Only the exact object returned by `pin` is accepted by `unpin`. */
export interface RegionPin {
  readonly region: number;
}

export interface RegionActivationStats {
  readonly regions: number;
  readonly columns: number;
  readonly rows: number;
  readonly active: number;
  readonly lingering: number;
  readonly observers: number;
  readonly pins: number;
  readonly updates: number;
  readonly closed: boolean;
}

export interface RegionActivation {
  readonly limits: RegionActivationLimits;
  readonly columns: number;
  readonly rows: number;
  /**
   * Region index containing a point, or -1 outside the grid extent (`minX .. minX + columns * cellSize`, likewise for
   * y; the last column/row may reach past maxX/maxY). Throws for non-finite coordinates. Queries accept -1 as "no
   * region": `isActive(-1)` is false, `stateOf(-1)` dormant, `epochOf(-1)` -1.
   */
  regionAt(x: number, y: number): number;
  /** Region index of a column/row, or -1 outside the grid. */
  regionIndex(column: number, row: number): number;
  stateOf(region: number): RegionState;
  /** Active or lingering: the caller should simulate it. */
  isActive(region: number): boolean;
  /** Advances on every activation and deactivation of the region; compare it to reject stale asynchronous work. */
  epochOf(region: number): number;
  /** Copy up to `out.length` active or lingering region indices (unordered) into `out`; returns the count. */
  activeRegions(out: Int32Array): number;
  addObserver(id: number, x: number, y: number): 'added' | 'duplicate' | 'saturated' | 'closed';
  moveObserver(id: number, x: number, y: number): 'moved' | 'absent' | 'closed';
  /** Forget an observer; regions it kept start lingering at the next update. */
  removeObserver(id: number): 'removed' | 'absent' | 'closed';
  pin(region: number): {status: 'pinned'; pin: RegionPin} | {status: 'saturated' | 'closed'};
  unpin(pin: RegionPin): 'unpinned' | 'absent' | 'closed';
  /** Recompute wanted and kept regions and apply bounded transitions into `out`. */
  update(out: RegionUpdateResult): RegionUpdateResult;
  /**
   * Terminal and idempotent: later mutating calls and updates report `closed`; queries report dormant, false, -1 or
   * zero. Grid addressing (`regionAt`, `regionIndex`) keeps working. Tables are released with the owner object.
   */
  dispose(): void;
  readonly stats: RegionActivationStats;
}

const KEYS = [
  'cellSize',
  'minX',
  'minY',
  'maxX',
  'maxY',
  'maxRegions',
  'activateRadius',
  'releaseRadius',
  'lingerUpdates',
  'maxObservers',
  'maxActive',
  'maxPins',
  'maxActivationsPerUpdate',
  'maxDeactivationsPerUpdate',
  'maxCellsPerObserver',
] as const;

const DORMANT = 0,
  ACTIVE = 1,
  LINGERING = 2;

function count(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
}
function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}
function checkId(id: number): void {
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0)
    throw new TypeError('region activation: observer id must be a nonnegative safe integer');
}
function checkPoint(x: number, y: number): void {
  if (!finite(x) || !finite(y)) throw new TypeError('region activation: coordinates must be finite numbers');
}

export function createRegionActivation(input: RegionActivationLimits): RegionActivation {
  if (input === null || typeof input !== 'object') throw new TypeError('region activation: limits must be an object');
  const extra = Object.keys(input).filter(k => !(KEYS as readonly string[]).includes(k));
  if (extra.length) throw new TypeError(`region activation: unknown limit '${extra[0]}'`);
  const limits: RegionActivationLimits = Object.freeze({
    cellSize: input.cellSize,
    minX: input.minX,
    minY: input.minY,
    maxX: input.maxX,
    maxY: input.maxY,
    maxRegions: input.maxRegions,
    activateRadius: input.activateRadius,
    releaseRadius: input.releaseRadius,
    lingerUpdates: input.lingerUpdates,
    maxObservers: input.maxObservers,
    maxActive: input.maxActive,
    maxPins: input.maxPins,
    maxActivationsPerUpdate: input.maxActivationsPerUpdate,
    maxDeactivationsPerUpdate: input.maxDeactivationsPerUpdate,
    maxCellsPerObserver: input.maxCellsPerObserver,
  });
  const {cellSize, minX, minY, maxX, maxY, activateRadius, releaseRadius, lingerUpdates} = limits;
  const {maxRegions, maxObservers, maxActive, maxPins, maxCellsPerObserver} = limits;
  const {maxActivationsPerUpdate, maxDeactivationsPerUpdate} = limits;

  if (!finite(cellSize) || cellSize <= 0) throw new RangeError('region activation: cellSize must be finite and > 0');
  if (![minX, minY, maxX, maxY].every(finite) || !(maxX > minX) || !(maxY > minY))
    throw new RangeError('region activation: the rectangle must be finite with max > min');
  if (!count(maxRegions) || maxRegions > REGION_CEILING.regions)
    throw new RangeError(`region activation: maxRegions must be a positive safe integer <= ${REGION_CEILING.regions}`);
  const columns = Math.ceil((maxX - minX) / cellSize),
    rows = Math.ceil((maxY - minY) / cellSize);
  if (!Number.isSafeInteger(columns) || !Number.isSafeInteger(rows) || columns * rows > maxRegions)
    throw new RangeError(`region activation: ${columns} x ${rows} regions exceed maxRegions ${maxRegions}`);
  const regions = columns * rows;
  // The grid extent: the last column/row may reach past maxX/maxY when the size is not a multiple of cellSize.
  const gridMaxX = minX + columns * cellSize,
    gridMaxY = minY + rows * cellSize;
  if (!finite(activateRadius) || activateRadius < 0)
    throw new RangeError('region activation: activateRadius must be finite and >= 0');
  if (!finite(releaseRadius) || releaseRadius < activateRadius || !Number.isFinite(releaseRadius * releaseRadius))
    throw new RangeError('region activation: releaseRadius must be finite, >= activateRadius, with a finite square');
  if (
    typeof lingerUpdates !== 'number' ||
    !Number.isSafeInteger(lingerUpdates) ||
    lingerUpdates < 0 ||
    lingerUpdates > REGION_CEILING.lingerUpdates
  )
    throw new RangeError(`region activation: lingerUpdates must be a safe integer 0..${REGION_CEILING.lingerUpdates}`);
  if (!count(maxObservers) || maxObservers > REGION_CEILING.observers)
    throw new RangeError(
      `region activation: maxObservers must be a positive safe integer <= ${REGION_CEILING.observers}`,
    );
  if (!count(maxActive) || maxActive > regions)
    throw new RangeError('region activation: maxActive must be a positive safe integer <= the region count');
  if (!count(maxPins) || maxPins > REGION_CEILING.pins)
    throw new RangeError(`region activation: maxPins must be a positive safe integer <= ${REGION_CEILING.pins}`);
  if (!count(maxActivationsPerUpdate) || maxActivationsPerUpdate > maxActive)
    throw new RangeError('region activation: maxActivationsPerUpdate must be a positive safe integer <= maxActive');
  if (!count(maxDeactivationsPerUpdate) || maxDeactivationsPerUpdate > maxActive)
    throw new RangeError('region activation: maxDeactivationsPerUpdate must be a positive safe integer <= maxActive');
  if (!count(maxCellsPerObserver) || maxCellsPerObserver > REGION_CEILING.cellsPerObserver)
    throw new RangeError(
      `region activation: maxCellsPerObserver must be a positive safe integer <= ${REGION_CEILING.cellsPerObserver}`,
    );
  // Worst case regions one scan visits: the release square widened by one region on each side (so rounding in the
  // column/row division can never exclude a region the exact distance test admits), clamped to the grid.
  const span = Math.floor((2 * releaseRadius) / cellSize) + 4,
    scanCells = Math.min(span, columns) * Math.min(span, rows);
  if (scanCells > maxCellsPerObserver)
    throw new RangeError(
      `region activation: releaseRadius ${releaseRadius} can touch ${scanCells} regions, above maxCellsPerObserver ${maxCellsPerObserver}`,
    );
  const activate2 = activateRadius * activateRadius,
    release2 = releaseRadius * releaseRadius;

  // Per-region tables.
  const state = new Uint8Array(regions),
    unkept = new Float64Array(regions),
    keepStamp = new Float64Array(regions),
    wantStamp = new Float64Array(regions),
    wantDist = new Float64Array(regions),
    pinCount = new Int32Array(regions),
    pinnedPos = new Int32Array(regions).fill(-1),
    epoch = new Float64Array(regions),
    lastDeactivated = new Float64Array(regions).fill(-1),
    activePos = new Int32Array(regions).fill(-1);
  const activeList = new Int32Array(maxActive);
  let activeCount = 0,
    lingeringCount = 0;
  // Candidates: distinct dormant regions wanted this update.
  const candidateCap = Math.min(regions, maxObservers * scanCells + maxPins);
  const candidates = new Int32Array(candidateCap);
  // Bounded top-k selections.
  const pickA = new Int32Array(maxActivationsPerUpdate),
    pickAD = new Float64Array(maxActivationsPerUpdate),
    pickD = new Int32Array(maxDeactivationsPerUpdate);

  // Observers.
  const slotOf = new Map<number, number>();
  const freeSlots: number[] = [];
  for (let i = maxObservers - 1; i >= 0; i--) freeSlots.push(i);
  const ox = new Float64Array(maxObservers),
    oy = new Float64Array(maxObservers),
    slotUsed = new Uint8Array(maxObservers);
  const pins = new Map<RegionPin, number>();
  // Distinct pinned regions, iterated by update without allocation.
  const pinned = new Int32Array(Math.min(regions, maxPins));
  let pinnedCount = 0;
  let gen = 0,
    updates = 0,
    closed = false;

  function checkRegion(region: number): void {
    if (typeof region !== 'number' || !Number.isSafeInteger(region) || region < 0 || region >= regions)
      throw new RangeError(`region activation: region must be an integer in 0..${regions - 1}`);
  }
  function column(x: number): number {
    const c = Math.floor((x - minX) / cellSize);
    return c >= columns ? columns - 1 : c;
  }
  function row(y: number): number {
    const r = Math.floor((y - minY) / cellSize);
    return r >= rows ? rows - 1 : r;
  }
  /** Region i (unkept u) is deactivated before region k. */
  function dueBefore(u: number, i: number, k: number): boolean {
    return u > unkept[k]! || (u === unkept[k] && i < k);
  }
  function addActive(region: number): void {
    activePos[region] = activeCount;
    activeList[activeCount++] = region;
  }
  function removeActive(region: number): void {
    const at = activePos[region]!,
      last = activeList[--activeCount]!;
    activeList[at] = last;
    activePos[last] = at;
    activePos[region] = -1;
  }

  /** Stamp kept/wanted regions around one point. */
  function scan(x: number, y: number): void {
    const c0 = Math.max(0, Math.floor((x - releaseRadius - minX) / cellSize) - 1),
      c1 = Math.min(columns - 1, Math.floor((x + releaseRadius - minX) / cellSize) + 1),
      r0 = Math.max(0, Math.floor((y - releaseRadius - minY) / cellSize) - 1),
      r1 = Math.min(rows - 1, Math.floor((y + releaseRadius - minY) / cellSize) + 1);
    for (let r = r0; r <= r1; r++) {
      const cy0 = minY + r * cellSize,
        dy = Math.max(cy0 - y, 0, y - (cy0 + cellSize));
      for (let c = c0; c <= c1; c++) {
        const cx0 = minX + c * cellSize,
          dx = Math.max(cx0 - x, 0, x - (cx0 + cellSize)),
          d2 = dx * dx + dy * dy;
        if (d2 > release2) continue;
        const i = r * columns + c;
        if (state[i] !== DORMANT) keepStamp[i] = gen;
        else if (d2 <= activate2) want(i, d2);
      }
    }
  }
  function want(i: number, d2: number): void {
    if (wantStamp[i] !== gen) {
      wantStamp[i] = gen;
      wantDist[i] = d2;
      candidates[candidateCount++] = i;
    } else if (d2 < wantDist[i]!) wantDist[i] = d2;
  }
  let candidateCount = 0;

  function emptyResult(out: RegionUpdateResult): RegionUpdateResult {
    out.status = 'closed';
    out.activatedCount = 0;
    out.deactivatedCount = 0;
    out.deferredActivations = 0;
    out.deferredDeactivations = 0;
    out.update = 0;
    return out;
  }
  function checkResult(out: RegionUpdateResult): void {
    if (!out || typeof out !== 'object' || Object.isFrozen(out))
      throw new TypeError('region activation: out must be a writable update result');
    if (
      !(out.activated instanceof Int32Array) ||
      !(out.dormantFor instanceof Float64Array) ||
      !(out.deactivated instanceof Int32Array) ||
      out.activated.length < maxActivationsPerUpdate ||
      out.dormantFor.length < maxActivationsPerUpdate ||
      out.deactivated.length < maxDeactivationsPerUpdate
    )
      throw new TypeError('region activation: result buffers are too small for these limits');
    if (
      out.activated.buffer === out.deactivated.buffer ||
      out.dormantFor.buffer === out.activated.buffer ||
      out.dormantFor.buffer === out.deactivated.buffer
    )
      throw new TypeError('region activation: result buffers must not share memory');
  }

  const owner: RegionActivation = {
    limits,
    columns,
    rows,
    regionAt(x, y) {
      checkPoint(x, y);
      if (x < minX || x > gridMaxX || y < minY || y > gridMaxY) return -1;
      return row(y) * columns + column(x);
    },
    regionIndex(c, r) {
      if (!Number.isSafeInteger(c) || !Number.isSafeInteger(r))
        throw new TypeError('region activation: column and row must be safe integers');
      return c < 0 || r < 0 || c >= columns || r >= rows ? -1 : r * columns + c;
    },
    stateOf(region) {
      if (region === -1) return 'dormant';
      checkRegion(region);
      if (closed) return 'dormant';
      const s = state[region];
      return s === ACTIVE ? 'active' : s === LINGERING ? 'lingering' : 'dormant';
    },
    isActive(region) {
      if (region === -1) return false;
      checkRegion(region);
      return !closed && state[region] !== DORMANT;
    },
    epochOf(region) {
      if (region === -1) return -1;
      checkRegion(region);
      return closed ? -1 : epoch[region]!;
    },
    activeRegions(out) {
      if (!(out instanceof Int32Array)) throw new TypeError('region activation: out must be an Int32Array');
      if (closed) return 0;
      const n = Math.min(activeCount, out.length);
      for (let k = 0; k < n; k++) out[k] = activeList[k]!;
      return n;
    },
    addObserver(id, x, y) {
      checkId(id);
      checkPoint(x, y);
      if (closed) return 'closed';
      if (slotOf.has(id)) return 'duplicate';
      const slot = freeSlots.pop();
      if (slot === undefined) return 'saturated';
      slotOf.set(id, slot);
      slotUsed[slot] = 1;
      ox[slot] = x;
      oy[slot] = y;
      return 'added';
    },
    moveObserver(id, x, y) {
      checkId(id);
      checkPoint(x, y);
      if (closed) return 'closed';
      const slot = slotOf.get(id);
      if (slot === undefined) return 'absent';
      ox[slot] = x;
      oy[slot] = y;
      return 'moved';
    },
    removeObserver(id) {
      checkId(id);
      if (closed) return 'closed';
      const slot = slotOf.get(id);
      if (slot === undefined) return 'absent';
      slotOf.delete(id);
      slotUsed[slot] = 0;
      freeSlots.push(slot);
      return 'removed';
    },
    pin(region) {
      checkRegion(region);
      if (closed) return {status: 'closed'};
      if (pins.size >= maxPins) return {status: 'saturated'};
      const handle: RegionPin = Object.freeze({region});
      pins.set(handle, region);
      if (pinCount[region]!++ === 0) {
        pinnedPos[region] = pinnedCount;
        pinned[pinnedCount++] = region;
      }
      return {status: 'pinned', pin: handle};
    },
    unpin(handle) {
      if (closed) return 'closed';
      const region = pins.get(handle);
      if (region === undefined) return 'absent';
      pins.delete(handle);
      if (--pinCount[region]! === 0) {
        const at = pinnedPos[region]!,
          last = pinned[--pinnedCount]!;
        pinned[at] = last;
        pinnedPos[last] = at;
        pinnedPos[region] = -1;
      }
      return 'unpinned';
    },
    update(out) {
      checkResult(out);
      if (closed) return emptyResult(out);
      updates++;
      gen++;
      candidateCount = 0;
      // 1. Stamp kept and wanted regions.
      for (let s = 0; s < maxObservers; s++) if (slotUsed[s]) scan(ox[s]!, oy[s]!);
      for (let p = 0; p < pinnedCount; p++) {
        const region = pinned[p]!;
        if (state[region] !== DORMANT) keepStamp[region] = gen;
        else want(region, -1); // pins rank before every observer
      }
      // 2. Kept regions reset; unkept ones linger; due ones are deactivation candidates (lowest index first).
      let due = 0,
        pickedD = 0;
      for (let k = 0; k < activeCount; k++) {
        const i = activeList[k]!;
        if (keepStamp[i] === gen) {
          if (state[i] === LINGERING) lingeringCount--;
          state[i] = ACTIVE;
          unkept[i] = 0;
          continue;
        }
        if (state[i] === ACTIVE) {
          state[i] = LINGERING;
          lingeringCount++;
        }
        if (++unkept[i]! <= lingerUpdates) continue;
        due++;
        // Bounded insertion: longest unkept first (no region waits forever), ties by ascending index.
        const u = unkept[i]!;
        if (pickedD === maxDeactivationsPerUpdate && !dueBefore(u, i, pickD[pickedD - 1]!)) continue;
        let j = pickedD < maxDeactivationsPerUpdate ? pickedD++ : pickedD - 1;
        while (j > 0 && dueBefore(u, i, pickD[j - 1]!)) {
          pickD[j] = pickD[j - 1]!;
          j--;
        }
        pickD[j] = i;
      }
      for (let k = 0; k < pickedD; k++) {
        const i = pickD[k]!;
        removeActive(i);
        state[i] = DORMANT;
        lingeringCount--;
        unkept[i] = 0;
        epoch[i]!++;
        lastDeactivated[i] = updates;
        out.deactivated[k] = i;
      }
      // 3. Activations: nearest first (pins first), ties by index, within budget and maxActive.
      const room = maxActive - activeCount,
        budget = Math.min(maxActivationsPerUpdate, room);
      let pickedA = 0;
      for (let k = 0; k < candidateCount; k++) {
        const i = candidates[k]!,
          d = wantDist[i]!;
        if (budget === 0) break;
        if (pickedA === budget) {
          const lastD = pickAD[budget - 1]!;
          if (lastD < d || (lastD === d && pickA[budget - 1]! < i)) continue;
        }
        let j = pickedA < budget ? pickedA++ : budget - 1;
        while (j > 0 && (pickAD[j - 1]! > d || (pickAD[j - 1] === d && pickA[j - 1]! > i))) {
          pickA[j] = pickA[j - 1]!;
          pickAD[j] = pickAD[j - 1]!;
          j--;
        }
        pickA[j] = i;
        pickAD[j] = d;
      }
      for (let k = 0; k < pickedA; k++) {
        const i = pickA[k]!;
        addActive(i);
        state[i] = ACTIVE;
        unkept[i] = 0;
        epoch[i]!++;
        out.activated[k] = i;
        out.dormantFor[k] = lastDeactivated[i]! < 0 ? -1 : updates - lastDeactivated[i]!;
      }
      out.activatedCount = pickedA;
      out.deactivatedCount = pickedD;
      out.deferredActivations = candidateCount - pickedA;
      out.deferredDeactivations = due - pickedD;
      out.update = updates;
      out.status =
        candidateCount > pickedA && room < Math.min(maxActivationsPerUpdate, candidateCount)
          ? 'saturated'
          : out.deferredActivations > 0 || out.deferredDeactivations > 0
            ? 'deferred'
            : 'complete';
      return out;
    },
    dispose() {
      if (closed) return;
      closed = true;
      slotOf.clear();
      pins.clear();
      freeSlots.length = 0;
      slotUsed.fill(0);
    },
    get stats(): RegionActivationStats {
      return {
        regions,
        columns,
        rows,
        active: closed ? 0 : activeCount,
        lingering: closed ? 0 : lingeringCount,
        observers: slotOf.size,
        pins: pins.size,
        updates,
        closed,
      };
    },
  };
  return Object.freeze(owner);
}
