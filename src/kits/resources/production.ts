import {
  createCheckpointInventory,
  type CheckpointInventorySnapshot,
  createInventoryLedger,
  type InventoryOptions,
  type InventorySnapshot,
  type MaterialBatch,
} from '../inventory/pure.js';
import {parseInventoryOperation, type InventoryAmount, type InventoryOutput} from '../inventory/ledger.js';
import {defineDeposit, identifier, integer, recipeSuitability, sampleDeposit, type Deposit} from './deposits.js';
export interface Recipe {
  id: string;
  inputs: readonly {batchId: string; quantity: number}[];
  output: {batch: MaterialBatch; quantity: number};
  suitability?: {weights: Record<string, number>; property: string};
}
interface JobBase {
  id: string;
  startTick: number;
  periodTicks: number;
  powered: boolean;
}
export type ProductionJob = JobBase &
  (
    | {kind: 'harvester'; depositId: string; x: number; z: number; container: string}
    | {kind: 'factory'; recipeId: string; inputContainer: string; outputContainer: string; limit: number}
  );
export interface ProductionOptions extends InventoryOptions {
  deposits: readonly Deposit[];
  recipes: readonly Recipe[];
  jobs: readonly ProductionJob[];
  initialInventory?: InventorySnapshot;
  maxCommands?: number;
}
export type ProductionCommand =
  | {kind: 'advance'; id: string; jobId: string; toTick: number; maxTicks: number; maxCycles: number}
  | {kind: 'configure'; id: string; jobId: string; atTick: number; powered: boolean; periodTicks: number}
  | {kind: 'exchange'; id: string; consume: readonly InventoryAmount[]; produce: readonly InventoryOutput[]};
export interface ProductionProgress {
  tick: number;
  progress: number;
  completed: number;
  powered: boolean;
  periodTicks: number;
}
export interface ProductionBase {
  inventory: CheckpointInventorySnapshot;
  remaining: Record<string, number>;
  jobs: Record<string, ProductionProgress>;
}
export interface ProductionSnapshot extends ProductionBase {
  version: 2;
  signature: string;
  epoch: number;
  base: ProductionBase;
  commands: ProductionCommand[];
}
export type ProductionResult =
  | {ok: true; duplicate: boolean; throughTick: number | null; produced: number; pending: boolean}
  | {
      ok: false;
      reason:
        | 'conflict'
        | 'unsettled'
        | 'capacity'
        | 'batch-conflict'
        | 'insufficient'
        | 'reservation'
        | 'history-full'
        | 'stale-epoch'
        | 'checkpoint-required'
        | 'materials-full';
    };
const MAX_COMMANDS = 4096;
const copy = <T>(value: T): T => structuredClone(value);

/** Capture bounded plain rows before delegating semantic validation to the inventory owner. */
function captureExchange(
  id: string,
  consume: readonly InventoryAmount[],
  produce: readonly InventoryOutput[],
): Extract<ProductionCommand, {kind: 'exchange'}> {
  const rows = <T>(input: readonly T[], read: (row: T) => T): T[] => {
    if (!Array.isArray(input)) throw Error('resources: expected exchange rows');
    const length = input.length;
    if (!Number.isSafeInteger(length) || length < 0 || length > 64) throw Error('resources: exchange row limit');
    const result: T[] = [];
    for (let i = 0; i < length; i++) result.push(read(input[i]!));
    return result;
  };
  const consumed = rows(consume, row => {
    const {container, batchId, quantity} = row;
    return {container, batchId, quantity};
  });
  const produced = rows(produce, row => {
    const {container, quantity, batch} = row;
    const {id: batchId, material, properties: supplied} = batch;
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied))
      throw Error('resources: invalid exchange properties');
    const keys = Object.keys(supplied);
    if (keys.length > 64) throw Error('resources: exchange property limit');
    const properties: Record<string, number> = Object.create(null);
    for (const key of keys) properties[key] = supplied[key]!;
    return {container, quantity, batch: {id: batchId, material, properties}};
  });
  const parsed = parseInventoryOperation({kind: 'exchange', id, consume: consumed, produce: produced});
  if (parsed.kind !== 'exchange') throw Error('resources: invalid exchange');
  return parsed;
}

/** One local owner for reserves, inventory, production clocks and retry receipts. */
export function createProduction(input: ProductionOptions, saved?: unknown) {
  const options = copy(input),
    deposits = new Map<string, Deposit>(),
    recipes = new Map<string, Recipe>(),
    jobs = new Map<string, ProductionJob>();
  for (const d of options.deposits) {
    if (deposits.has(d.id)) throw Error('resources: duplicate deposit');
    deposits.set(d.id, defineDeposit(d));
  }
  const maxCommands = integer(options.maxCommands ?? 256, 1, MAX_COMMANDS);
  const seed = createInventoryLedger(options, options.initialInventory).snapshot();
  const ledgerOptions = {
    capacities: options.capacities,
    maxOperations: maxCommands + seed.operations.length,
    maxMaterials: 1024,
  };
  let ledger = createCheckpointInventory(ledgerOptions),
    epoch = 0;
  for (const operation of seed.operations) {
    const result = ledger.apply(0, operation);
    if (!result.ok) throw Error('resources: invalid initial inventory');
  }
  const knownBatches = new Set<string>();
  for (const op of seed.operations)
    if ('produce' in op) for (const output of op.produce) knownBatches.add(output.batch.id);
  for (const d of deposits.values()) knownBatches.add(d.batch.id);
  for (const r of options.recipes) {
    identifier(r.id);
    if (recipes.has(r.id) || !r.inputs.length) throw Error('resources: invalid recipe');
    const seen = new Set<string>();
    for (const i of r.inputs) {
      identifier(i.batchId);
      integer(i.quantity, 1, 1_000_000);
      if (seen.has(i.batchId)) throw Error('resources: duplicate ingredient');
      seen.add(i.batchId);
    }
    integer(r.output.quantity, 1, 1_000_000);
    // Reuse inventory's metadata parser, without producing anything in the live ledger.
    const probe = createInventoryLedger({capacities: {validate: Number.MAX_SAFE_INTEGER}});
    probe.transact('validate', [], [{container: 'validate', ...r.output}]);
    if (r.suitability) {
      identifier(r.suitability.property);
      const zero = Object.fromEntries(Object.keys(r.suitability.weights).map(k => [k, 0]));
      recipeSuitability(zero, r.suitability.weights);
    }
    recipes.set(r.id, r);
    knownBatches.add(r.output.batch.id);
  }
  const progress = new Map<string, ProductionProgress>(),
    remaining = new Map([...deposits].map(([id, d]) => [id, d.reserve]));
  const container = (id: string) => {
    if (!Object.hasOwn(options.capacities, id)) throw Error('resources: unknown container');
  };
  for (const job of options.jobs) {
    identifier(job.id);
    integer(job.startTick);
    integer(job.periodTicks, 1, 1_000_000);
    if (jobs.has(job.id) || typeof job.powered !== 'boolean') throw Error('resources: invalid job');
    if (job.kind === 'harvester') {
      const d = deposits.get(job.depositId);
      if (!d) throw Error('resources: unknown deposit');
      sampleDeposit(d, job.x, job.z);
      container(job.container);
    } else if (job.kind === 'factory') {
      if (!recipes.has(job.recipeId)) throw Error('resources: unknown recipe');
      integer(job.limit);
      container(job.inputContainer);
      container(job.outputContainer);
    } else throw Error('resources: unknown job kind');
    jobs.set(job.id, job);
    progress.set(job.id, {
      tick: job.startTick,
      progress: 0,
      completed: 0,
      powered: job.powered,
      periodTicks: job.periodTicks,
    });
  }
  if (jobs.size > 64 || deposits.size > 256 || recipes.size > 256 || knownBatches.size > 1024)
    throw Error('resources: production limits exceeded');
  const signature = JSON.stringify(options),
    commands: ProductionCommand[] = [];
  const receipts = new Map<string, {signature: string; result: ProductionResult}>();
  const room = (id: string) => {
    let used = 0;
    for (const batch of knownBatches) used += ledger.quantity(id, batch);
    return options.capacities[id]! - used;
  };
  const baseState = (): ProductionBase => ({
    inventory: ledger.snapshot(),
    remaining: Object.fromEntries(remaining),
    jobs: Object.fromEntries([...progress].map(([id, value]) => [id, {...value}])),
  });
  let base = baseState(),
    busy = false;
  const guarded = <T>(work: () => T): T => {
    if (busy) throw Error('resources: reentrant mutation');
    busy = true;
    try {
      return work();
    } finally {
      busy = false;
    }
  };
  const applyInternal = (raw: ProductionCommand, requestEpoch = 0): ProductionResult => {
    integer(requestEpoch);
    if (requestEpoch !== epoch) return {ok: false, reason: 'stale-epoch'};
    const {id, kind} = raw;
    identifier(id);
    let command: ProductionCommand;
    if (kind === 'advance') {
      const {jobId, toTick, maxTicks, maxCycles} = raw as Extract<ProductionCommand, {kind: 'advance'}>;
      identifier(jobId);
      integer(toTick);
      integer(maxTicks, 1, 1_000_000);
      integer(maxCycles, 1, 1024);
      command = {kind, id, jobId, toTick, maxTicks, maxCycles};
    } else if (kind === 'configure') {
      const {jobId, atTick, periodTicks, powered} = raw as Extract<ProductionCommand, {kind: 'configure'}>;
      identifier(jobId);
      integer(atTick);
      integer(periodTicks, 1, 1_000_000);
      if (typeof powered !== 'boolean') throw Error('resources: invalid power state');
      command = {kind, id, jobId, atTick, powered, periodTicks};
    } else if (kind === 'exchange') {
      const {consume, produce} = raw as Extract<ProductionCommand, {kind: 'exchange'}>;
      command = captureExchange(id, consume, produce);
    } else throw Error('resources: unknown command');
    const key = JSON.stringify(command),
      previous = receipts.get(command.id);
    if (previous)
      return previous.signature === key
        ? ({...previous.result, duplicate: true} as ProductionResult)
        : {ok: false, reason: 'conflict'};
    if (commands.length >= maxCommands) return {ok: false, reason: 'checkpoint-required'};
    if (command.kind === 'exchange') {
      const nextKnown = new Set(knownBatches);
      for (const row of command.produce) nextKnown.add(row.batch.id);
      if (nextKnown.size > 1024) return {ok: false, reason: 'materials-full'};
      const candidate = createCheckpointInventory(ledgerOptions, ledger.snapshot());
      const exchanged = candidate.apply(epoch, {
        ...command,
        consume: [...command.consume],
        produce: [...command.produce],
      });
      if (!exchanged.ok)
        return {ok: false, reason: exchanged.reason as Extract<ProductionResult, {ok: false}>['reason']};
      if (exchanged.duplicate) return {ok: false, reason: 'conflict'};
      const result: ProductionResult = {ok: true, duplicate: false, throughTick: null, produced: 0, pending: false};
      ledger = candidate;
      for (const batch of nextKnown) knownBatches.add(batch);
      commands.push(command);
      receipts.set(command.id, {signature: key, result: {...result}});
      return result;
    }
    const job = jobs.get(command.jobId),
      old = progress.get(command.jobId);
    if (!job || !old) throw Error('resources: unknown job');
    const next = {...old};
    let produced = 0,
      pending = false;
    if (command.kind === 'configure') {
      integer(command.atTick);
      integer(command.periodTicks, 1, 1_000_000);
      if (typeof command.powered !== 'boolean') throw Error('resources: invalid power state');
      if (old.tick !== command.atTick) return {ok: false, reason: 'unsettled'};
      // Changing speed cannot retroactively reprice work already accumulated.
      if (next.periodTicks !== command.periodTicks && next.progress !== 0) return {ok: false, reason: 'unsettled'};
      next.powered = command.powered;
      next.periodTicks = command.periodTicks;
    } else if (command.kind === 'advance') {
      integer(command.toTick);
      integer(command.maxTicks, 1, 1_000_000);
      integer(command.maxCycles, 1, 1024);
      if (command.toTick < old.tick) throw Error('resources: time moved backwards');
      const deposit = job.kind === 'harvester' ? deposits.get(job.depositId)! : undefined;
      const density = deposit && job.kind === 'harvester' ? sampleDeposit(deposit, job.x, job.z) : 1;
      const period = density > 0 ? Math.ceil(old.periodTicks / density) : Infinity;
      const duration = Math.min(
        command.toTick - old.tick,
        command.maxTicks,
        Number.isFinite(period) ? Math.max(1, command.maxCycles * period - old.progress) : command.maxTicks,
      );
      next.tick += duration;
      pending = next.tick < command.toTick;
      const activeTime = deposit
        ? Math.max(0, Math.min(next.tick, deposit.expiresTick) - Math.min(old.tick, deposit.expiresTick))
        : duration;
      const earned = old.powered && density > 0 && Number.isFinite(period) ? old.progress + activeTime : old.progress;
      const wanted = old.powered && Number.isFinite(period) ? Math.floor(earned / period) : 0;
      next.progress = wanted ? earned - wanted * period : earned;
      if (wanted > 0) {
        const candidate = createCheckpointInventory(ledgerOptions, ledger.snapshot());
        if (job.kind === 'harvester') {
          produced = Math.min(wanted, remaining.get(job.depositId)!, room(job.container));
          if (produced > 0) {
            const result = candidate.apply(epoch, {
              kind: 'exchange',
              id: command.id,
              consume: [],
              produce: [{container: job.container, batch: deposit!.batch, quantity: produced}],
            });
            if (!result.ok)
              return {ok: false, reason: result.reason as Extract<ProductionResult, {ok: false}>['reason']};
            if (result.duplicate) return {ok: false, reason: 'conflict'};
          }
        } else {
          const recipe = recipes.get(job.recipeId)!;
          const consumedSpace =
            job.inputContainer === job.outputContainer ? recipe.inputs.reduce((sum, i) => sum + i.quantity, 0) : 0;
          const netSpace = recipe.output.quantity - consumedSpace;
          produced = Math.min(
            wanted,
            netSpace > 0 ? Math.floor(room(job.outputContainer) / netSpace) : wanted,
            job.limit - old.completed,
          );
          for (const i of recipe.inputs)
            produced = Math.min(produced, Math.floor(ledger.available(job.inputContainer, i.batchId) / i.quantity));
          if (produced > 0) {
            const batch = copy(recipe.output.batch);
            if (recipe.suitability) {
              let score = 0,
                units = 0;
              for (const i of recipe.inputs) {
                score +=
                  recipeSuitability(ledger.material(i.batchId)!.properties, recipe.suitability.weights) * i.quantity;
                units += i.quantity;
              }
              Object.defineProperty(batch.properties, recipe.suitability.property, {
                value: score / units,
                enumerable: true,
                configurable: true,
                writable: true,
              });
            }
            const result = candidate.apply(epoch, {
              kind: 'exchange',
              id: command.id,
              consume: recipe.inputs.map(i => ({
                container: job.inputContainer,
                batchId: i.batchId,
                quantity: i.quantity * produced,
              })),
              produce: [{container: job.outputContainer, batch, quantity: recipe.output.quantity * produced}],
            });
            if (!result.ok)
              return {ok: false, reason: result.reason as Extract<ProductionResult, {ok: false}>['reason']};
            if (result.duplicate) return {ok: false, reason: 'conflict'};
          }
        }
        // A blocked machine does not bank free work to spend after its hopper/input changes.
        if (produced < wanted) next.progress = 0;
        if (produced > 0) {
          if (!Number.isSafeInteger(next.completed + produced)) throw Error('resources: production counter overflow');
          next.completed += produced;
          ledger = candidate;
          if (job.kind === 'harvester') remaining.set(job.depositId, remaining.get(job.depositId)! - produced);
        }
      }
    } else throw Error('resources: unknown command');
    progress.set(job.id, next);
    const result: ProductionResult = {ok: true, duplicate: false, throughTick: next.tick, produced, pending};
    commands.push(command);
    receipts.set(command.id, {signature: key, result: {...result}});
    return result;
  };
  const apply = (raw: ProductionCommand, requestEpoch = 0): ProductionResult =>
    guarded(() => applyInternal(raw, requestEpoch));
  const snapshot = (): ProductionSnapshot => ({
    version: 2,
    signature,
    epoch,
    base: copy(base),
    commands: copy(commands),
    ...baseState(),
  });
  if (saved !== undefined) {
    if (!saved || typeof saved !== 'object') throw Error('resources: invalid snapshot');
    const s = saved as ProductionSnapshot;
    if (
      s.version !== 2 ||
      s.signature !== signature ||
      !Array.isArray(s.commands) ||
      s.commands.length > maxCommands ||
      !s.base
    )
      throw Error('resources: snapshot configuration/version mismatch');
    integer(s.epoch);
    epoch = s.epoch;
    if (s.base.inventory.epoch !== epoch) throw Error('resources: mixed checkpoint epochs');
    ledger = createCheckpointInventory(ledgerOptions, s.base.inventory);
    for (const batch of ledger.snapshot().materials) knownBatches.add(batch.id);
    if (knownBatches.size > 1024) throw Error('resources: production material limit');
    if (Object.keys(s.base.remaining).length !== deposits.size || Object.keys(s.base.jobs).length !== jobs.size)
      throw Error('resources: checkpoint identity mismatch');
    for (const [id, deposit] of deposits) remaining.set(id, integer(s.base.remaining[id]!, 0, deposit.reserve));
    for (const [id, job] of jobs) {
      const p = s.base.jobs[id];
      if (!p || typeof p.powered !== 'boolean') throw Error('resources: invalid checkpoint progress');
      integer(p.tick, job.startTick);
      integer(p.periodTicks, 1, 1_000_000);
      integer(p.completed, 0, job.kind === 'factory' ? job.limit : Number.MAX_SAFE_INTEGER);
      integer(p.progress);
      const density = job.kind === 'harvester' ? sampleDeposit(deposits.get(job.depositId)!, job.x, job.z) : 1;
      const period = density > 0 ? Math.ceil(p.periodTicks / density) : Infinity;
      if (p.progress >= period || (!Number.isFinite(period) && p.progress !== 0))
        throw Error('resources: invalid partial cycle');
      progress.set(id, {...p});
    }
    base = baseState();
    for (const c of s.commands) {
      const result = apply(c, epoch);
      if (!result.ok || result.duplicate) throw Error('resources: invalid history');
    }
    const actual = snapshot();
    if (
      JSON.stringify(actual.inventory) !== JSON.stringify(s.inventory) ||
      JSON.stringify(actual.remaining) !== JSON.stringify(s.remaining) ||
      JSON.stringify(actual.jobs) !== JSON.stringify(s.jobs)
    )
      throw Error('resources: snapshot state does not match history');
  }
  return {
    apply,
    snapshot,
    quantity: ledgerQuantity,
    material: (id: string) => ledger.material(id),
    get epoch() {
      return epoch;
    },
    /** Persist this complete new epoch before accepting any requests naming it. */
    checkpoint() {
      return guarded(() => {
        const next = createCheckpointInventory(ledgerOptions, ledger.snapshot());
        const nextEpoch = next.checkpoint();
        ledger = next;
        epoch = nextEpoch;
        base = baseState();
        commands.length = 0;
        receipts.clear();
        return epoch;
      });
    },
  };
  function ledgerQuantity(containerId: string, batchId: string): number {
    return ledger.quantity(containerId, batchId);
  }
}
