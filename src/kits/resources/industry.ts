import {
  StockValidationError,
  parseDimensionalStock,
  prepareStockChange,
  prepareStockTransfers,
  type StockTransfer,
  type DimensionalStock,
  type StockBatch,
  type StockBounds,
  type StockContainer,
  type StockPosition,
} from '../inventory/dimensional.js';

export interface IndustrialDeposit {
  id: string;
  body: string;
  region: string;
  batch: string;
  remaining: number;
}
/** An accepted manufacturing plan, supplied by the enclosing authored recipe/experiment authority. */
export interface IndustrialPlan {
  id: string;
  inputs: {batch: string; quantity: number}[];
  outputs: {batch: StockBatch; quantity: number}[];
  workJ: number;
  maxPowerW: number;
}
export interface IndustrialMachine {
  id: string;
  plan: string;
  input: string;
  output: string;
  work: string;
  installed: string;
  powered: boolean;
  active: boolean;
  progressJ: number;
  completed: number;
  energyRemainder: number;
}
export interface IndustrialState {
  version: 1;
  stock: DimensionalStock;
  deposits: IndustrialDeposit[];
  plans: IndustrialPlan[];
  machines: IndustrialMachine[];
}
export interface IndustryBounds {
  stock: StockBounds;
  deposits: number;
  plans: number;
  machines: number;
  maxStepTicks: number;
}
export type IndustryCommand =
  | {kind: 'harvest'; deposit: string; container: string; quantity: number}
  | {kind: 'transfer-batch'; transfers: StockTransfer[]}
  | {kind: 'transfer'; from: string; to: string; batch: string; quantity: number}
  | {
      kind: 'construct';
      machine: Omit<IndustrialMachine, 'powered' | 'active' | 'progressJ' | 'completed' | 'energyRemainder'>;
      containers: StockContainer[];
      bill: StockPosition[];
    }
  | {kind: 'power'; machine: string; enabled: boolean}
  | {kind: 'step'; machine: string; ticks: number; allocatedPowerW: number}
  | {kind: 'cancel'; machine: string};
export type IndustryResult =
  | {
      ok: true;
      state: IndustrialState;
      workJ: number;
      energyDeciJ: number;
      elapsedTicks: number;
      completed: boolean;
      blocked?: 'unpowered' | 'input' | 'output';
    }
  | {ok: false; reason: string};
class Invalid extends Error {}
const error = (s: string): never => {
  throw new Invalid(s);
};
const id = (v: unknown): string => (typeof v === 'string' && v.length > 0 && v.length <= 256 ? v : error('invalid-id'));
const n = (v: unknown, positive = false): number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= (positive ? 1 : 0) ? v : error('invalid-number');
const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : error('invalid-record');
function arr(v: unknown, max: number): unknown[] {
  if (!Array.isArray(v)) return error('limit');
  const length = v.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > max) return error('limit');
  const result: unknown[] = [];
  for (let i = 0; i < length; i++) result.push(v[i]);
  return result;
}
function unique<T extends {id: string}>(values: T[]): T[] {
  if (new Set(values.map(v => v.id)).size !== values.length) return error('duplicate-id');
  return values;
}
const quantity = (s: DimensionalStock, container: string, batch: string) =>
  s.positions.find(p => p.container === container && p.batch === batch)?.quantity ?? 0;
function stockChange(s: IndustrialState, change: Parameters<typeof prepareStockChange>[1], b: IndustryBounds) {
  const r = prepareStockChange(s.stock, change, b.stock);
  if (!r.ok) return error(r.reason);
  s.stock = r.state;
  return r;
}
function plan(raw: unknown, stock: DimensionalStock, b: IndustryBounds): IndustrialPlan {
  const p = rec(raw),
    inputs = arr(p.inputs, b.stock.changes).map(v => {
      const i = rec(v);
      return {batch: id(i.batch), quantity: n(i.quantity, true)};
    });
  if (!inputs.length || new Set(inputs.map(i => i.batch)).size !== inputs.length) return error('invalid-inputs');
  const outputRaw = arr(p.outputs, b.stock.changes).map(v => {
    const o = rec(v);
    return {batch: o.batch as StockBatch, quantity: n(o.quantity, true)};
  });
  if (!outputRaw.length) return error('invalid-outputs');
  if (inputs.length * 2 > b.stock.changes || inputs.length + outputRaw.length * 2 > b.stock.changes)
    return error('plan-operation-limit');
  const probe = prepareStockChange(stock, {issueBatches: outputRaw.map(o => o.batch)}, b.stock);
  if (!probe.ok) return error(probe.reason);
  const outputs = outputRaw.map(o => ({
    batch: probe.state.batches.find(x => x.id === id(rec(o.batch).id))!,
    quantity: o.quantity,
  }));
  if (new Set(outputs.map(o => o.batch.id)).size !== outputs.length) return error('invalid-outputs');
  let inputMass = 0n,
    outputMass = 0n;
  for (const i of inputs) {
    const batch = stock.batches.find(x => x.id === i.batch);
    if (!batch) return error('unknown-batch');
    inputMass += BigInt(batch.massMg) * BigInt(i.quantity);
  }
  for (const o of outputs) outputMass += BigInt(o.batch.massMg) * BigInt(o.quantity);
  if (inputMass !== outputMass) return error('unbalanced-plan');
  const workJ = n(p.workJ, true);
  if (workJ > Math.floor(Number.MAX_SAFE_INTEGER / 10)) return error('work-limit');
  return {id: id(p.id), inputs, outputs, workJ, maxPowerW: n(p.maxPowerW, true)};
}
/** Strict data restoration; no caller-owned arrays or records survive. */
export function parseIndustrialState(raw: unknown, b: IndustryBounds): IndustrialState {
  for (const v of [b.deposits, b.plans, b.machines, b.maxStepTicks]) n(v, true);
  const s = rec(raw);
  if (s.version !== 1) return error('invalid-version');
  const stock = parseDimensionalStock(s.stock, b.stock);
  const deposits = unique(
    arr(s.deposits, b.deposits).map(v => {
      const d = rec(v);
      const batch = id(d.batch);
      if (!stock.batches.some(x => x.id === batch)) return error('unknown-batch');
      return {id: id(d.id), body: id(d.body), region: id(d.region), batch, remaining: n(d.remaining)};
    }),
  );
  const plans = unique(arr(s.plans, b.plans).map(p => plan(p, stock, b)));
  // Register every plan output in a single validation pass, catching conflicts between different plans.
  const outputs = plans.flatMap(p => p.outputs.map(o => o.batch));
  let checked = stock;
  for (const batch of outputs) {
    const r = prepareStockChange(checked, {issueBatches: [batch]}, b.stock);
    if (!r.ok) return error(r.reason);
    checked = r.state;
  }
  const occupied = new Set<string>();
  const machines = unique(
    arr(s.machines, b.machines).map(v => {
      const m = rec(v),
        p = plans.find(p => p.id === m.plan);
      if (!p) return error('unknown-plan');
      const ports = ['input', 'output', 'work', 'installed'] as const;
      const ids = ports.map(k => id(m[k]));
      if (new Set(ids).size !== ids.length) return error('overlapping-containers');
      for (const cid of ids) {
        if (occupied.has(cid) || !stock.containers.some(c => c.id === cid)) return error('invalid-machine-container');
        occupied.add(cid);
      }
      if (typeof m.active !== 'boolean' || typeof m.powered !== 'boolean') return error('invalid-machine');
      const progressJ = n(m.progressJ),
        energyRemainder = n(m.energyRemainder);
      if (
        progressJ > p.workJ ||
        energyRemainder > 9 ||
        (progressJ === p.workJ && energyRemainder !== 0) ||
        (!m.active && (progressJ !== 0 || energyRemainder !== 0))
      )
        return error('invalid-progress');
      const contents = stock.positions.filter(v => v.container === m.work);
      if (m.active) {
        if (
          contents.length !== p.inputs.length ||
          p.inputs.some(i => quantity(stock, id(m.work), i.batch) !== i.quantity)
        )
          return error('invalid-work-custody');
      } else if (contents.length) return error('invalid-work-custody');
      return {
        id: id(m.id),
        plan: p.id,
        input: ids[0]!,
        output: ids[1]!,
        work: ids[2]!,
        installed: ids[3]!,
        powered: m.powered,
        active: m.active,
        progressJ,
        energyRemainder,
        completed: n(m.completed),
      };
    }),
  );
  return {version: 1, stock, deposits, plans, machines};
}
/**
 * Prepares one bounded step within the enclosing world transaction. No clock, storage, or independent
 * stock owner. Outer authority owns command receipts, plan acceptance, placement and power allocation.
 * A step completes at most one cycle; elapsedTicks reports the settled interval; callers retain unused ticks for bounded catchup.
 */
function prepareParsedIndustryCommand(
  source: IndustrialState,
  rawCommand: IndustryCommand,
  b: IndustryBounds,
): IndustryResult {
  try {
    // Only these records are mutated below. Stock transforms return new validated data;
    // plans and all unchanged stock remain private immutable inputs to this transition.
    const s: IndustrialState = {
      ...source,
      deposits: source.deposits.map(d => ({...d})),
      machines: source.machines.map(m => ({...m})),
    };
    const c = rec(rawCommand);
    const protectedContainer = (cid: string) => s.machines.some(m => m.work === cid || m.installed === cid);
    if (c.kind === 'harvest') {
      const d = s.deposits.find(d => d.id === id(c.deposit));
      if (!d) return error('unknown-deposit');
      const amount = n(c.quantity, true),
        target = id(c.container);
      if (protectedContainer(target)) return error('protected-container');
      if (amount > d.remaining) return error('depleted');
      stockChange(s, {produce: [{container: target, batch: d.batch, quantity: amount}]}, b);
      d.remaining -= amount;
    } else if (c.kind === 'transfer') {
      const from = id(c.from),
        to = id(c.to),
        batch = id(c.batch),
        amount = n(c.quantity, true);
      if (protectedContainer(from) || protectedContainer(to)) return error('protected-container');
      stockChange(
        s,
        {consume: [{container: from, batch, quantity: amount}], produce: [{container: to, batch, quantity: amount}]},
        b,
      );
    } else if (c.kind === 'transfer-batch') {
      const transfers = arr(c.transfers, Math.floor(b.stock.changes / 2)).map(value => {
        const t = rec(value),
          from = id(t.from),
          to = id(t.to);
        if (protectedContainer(from) || protectedContainer(to)) return error('protected-container');
        return {from, to, batch: id(t.batch), quantity: n(t.quantity, true)};
      });
      const result = prepareStockTransfers(s.stock, transfers, b.stock);
      if (!result.ok) return error(result.reason);
      s.stock = result.state;
    } else if (c.kind === 'construct') {
      if (s.machines.length >= b.machines) return error('limit');
      const m = rec(c.machine),
        machineId = id(m.id);
      if (s.machines.some(x => x.id === machineId)) return error('duplicate-id');
      const machine: IndustrialMachine = {
        id: machineId,
        plan: id(m.plan),
        input: id(m.input),
        output: id(m.output),
        work: id(m.work),
        installed: id(m.installed),
        powered: false,
        active: false,
        progressJ: 0,
        completed: 0,
        energyRemainder: 0,
      };
      const containers = arr(c.containers, 4) as StockContainer[];
      if (
        containers.length !== 4 ||
        new Set(containers.map(v => id(rec(v).id))).size !== 4 ||
        [machine.input, machine.output, machine.work, machine.installed].some(
          cid => !containers.some(v => v.id === cid),
        )
      )
        return error('invalid-machine-container');
      const bill = arr(c.bill, b.stock.changes).map(v => {
        const p = rec(v);
        const container = id(p.container);
        if (protectedContainer(container)) return error('protected-container');
        return {container, batch: id(p.batch), quantity: n(p.quantity, true)};
      });
      if (!bill.length) return error('empty-bill');
      stockChange(
        s,
        {addContainers: containers, consume: bill, produce: bill.map(p => ({...p, container: machine.installed}))},
        b,
      );
      s.machines.push(machine);
    } else if (c.kind === 'power' || c.kind === 'step' || c.kind === 'cancel') {
      const m = s.machines.find(m => m.id === id(c.machine));
      if (!m) return error('unknown-machine');
      const p = s.plans.find(p => p.id === m.plan)!;
      if (c.kind === 'power') {
        if (typeof c.enabled !== 'boolean') return error('invalid-power');
        m.powered = c.enabled;
      } else if (c.kind === 'cancel') {
        if (m.active)
          stockChange(
            s,
            {
              consume: p.inputs.map(i => ({...i, container: m.work})),
              produce: p.inputs.map(i => ({...i, container: m.input})),
            },
            b,
          );
        m.active = false;
        m.progressJ = 0;
        m.energyRemainder = 0;
      } else {
        const ticks = n(c.ticks, true),
          power = n(c.allocatedPowerW);
        if (ticks > b.maxStepTicks || power > p.maxPowerW) return error('limit');
        if ((!m.powered || power === 0) && !(m.active && m.progressJ === p.workJ))
          return {
            ok: true,
            state: s,
            workJ: 0,
            energyDeciJ: 0,
            elapsedTicks: ticks,
            completed: false,
            blocked: 'unpowered',
          };
        if (!m.active) {
          // The private source is already validated. A known shortage cannot reserve
          // any stock, so do not rebuild the complete inventory for an idle tick.
          if (p.inputs.some(i => quantity(s.stock, m.input, i.batch) < i.quantity))
            return {
              ok: true,
              state: s,
              workJ: 0,
              energyDeciJ: 0,
              elapsedTicks: ticks,
              completed: false,
              blocked: 'input',
            };
          const reserved = prepareStockChange(
            s.stock,
            {
              consume: p.inputs.map(i => ({...i, container: m.input})),
              produce: p.inputs.map(i => ({...i, container: m.work})),
            },
            b.stock,
          );
          if (!reserved.ok) {
            if (reserved.reason !== 'insufficient' && reserved.reason !== 'capacity') return error(reserved.reason);
            return {
              ok: true,
              state: s,
              workJ: 0,
              energyDeciJ: 0,
              elapsedTicks: ticks,
              completed: false,
              blocked: 'input',
            };
          }
          s.stock = reserved.state;
          m.active = true;
        }
        const available = BigInt(power) * BigInt(ticks) + BigInt(m.energyRemainder);
        const earned = available / 10n,
          remaining = p.workJ - m.progressJ;
        const requiredDeciJ = BigInt(remaining) * 10n - BigInt(m.energyRemainder);
        const delivered = BigInt(power) * BigInt(ticks);
        const energyDeciJ = Number(delivered < requiredDeciJ ? delivered : requiredDeciJ);
        const neededTicks = remaining === 0 ? 0n : (requiredDeciJ + BigInt(power) - 1n) / BigInt(power);
        const elapsedTicks = Number(neededTicks < BigInt(ticks) ? neededTicks : BigInt(ticks));
        const workJ = Number(earned > BigInt(remaining) ? BigInt(remaining) : earned);
        m.progressJ += workJ;
        m.energyRemainder = m.progressJ === p.workJ ? 0 : Number(available % 10n);
        if (m.progressJ === p.workJ) {
          const done = prepareStockChange(
            s.stock,
            {
              issueBatches: p.outputs.map(o => o.batch),
              consume: p.inputs.map(i => ({...i, container: m.work})),
              produce: p.outputs.map(o => ({container: m.output, batch: o.batch.id, quantity: o.quantity})),
            },
            b.stock,
          );
          if (!done.ok) {
            if (done.reason !== 'capacity') return error(done.reason);
            return {ok: true, state: s, workJ, energyDeciJ, elapsedTicks: ticks, completed: false, blocked: 'output'};
          }
          s.stock = done.state;
          m.active = false;
          m.progressJ = 0;
          m.energyRemainder = 0;
          m.completed = n(m.completed + 1);
          return {ok: true, state: s, workJ, energyDeciJ, elapsedTicks, completed: true};
        }
        return {ok: true, state: s, workJ, energyDeciJ, elapsedTicks, completed: false};
      }
    } else return error('invalid-command');
    return {
      ok: true,
      state: c.kind === 'construct' ? parseIndustrialState(s, b) : s,
      workJ: 0,
      energyDeciJ: 0,
      elapsedTicks: 0,
      completed: false,
    };
  } catch (e) {
    if (e instanceof StockValidationError) return {ok: false, reason: e.reason};
    if (e instanceof Invalid) return {ok: false, reason: e.message};
    throw e;
  }
}

/** Compatibility API: every independent call validates and isolates the complete supplied state. */
export function prepareIndustryCommand(raw: unknown, command: IndustryCommand, bounds: IndustryBounds): IndustryResult {
  try {
    return prepareParsedIndustryCommand(parseIndustrialState(raw, bounds), command, bounds);
  } catch (e) {
    if (e instanceof StockValidationError) return {ok: false, reason: e.reason};
    if (e instanceof Invalid) return {ok: false, reason: e.message};
    throw e;
  }
}

/** Capture only admitted schema fields, never enumerate or clone an arbitrary caller graph. */
function captureIndustryCommand(raw: unknown, bounds: IndustryBounds): IndustryCommand {
  const c = rec(raw),
    kind = c.kind;
  switch (kind) {
    case 'harvest':
      return {kind, deposit: id(c.deposit), container: id(c.container), quantity: n(c.quantity, true)};
    case 'transfer-batch':
      return {
        kind,
        transfers: arr(c.transfers, Math.floor(bounds.stock.changes / 2)).map(value => {
          const t = rec(value);
          return {from: id(t.from), to: id(t.to), batch: id(t.batch), quantity: n(t.quantity, true)};
        }),
      };
    case 'transfer':
      return {kind, from: id(c.from), to: id(c.to), batch: id(c.batch), quantity: n(c.quantity, true)};
    case 'power': {
      const machine = id(c.machine),
        enabled = c.enabled;
      if (typeof enabled !== 'boolean') return error('invalid-power');
      return {kind, machine, enabled};
    }
    case 'step':
      return {kind, machine: id(c.machine), ticks: n(c.ticks, true), allocatedPowerW: n(c.allocatedPowerW)};
    case 'cancel':
      return {kind, machine: id(c.machine)};
    case 'construct': {
      const m = rec(c.machine);
      const machine = {
        id: id(m.id),
        plan: id(m.plan),
        input: id(m.input),
        output: id(m.output),
        work: id(m.work),
        installed: id(m.installed),
      };
      const containers = arr(c.containers, 4).map(value => {
        const container = rec(value);
        return {
          id: id(container.id),
          maxMassMg: n(container.maxMassMg),
          maxVolumeUl: n(container.maxVolumeUl),
          phases: arr(container.phases, bounds.stock.changes).map(id),
        };
      });
      const bill = arr(c.bill, bounds.stock.changes).map(value => {
        const position = rec(value);
        return {container: id(position.container), batch: id(position.batch), quantity: n(position.quantity, true)};
      });
      return {kind, machine, containers, bill};
    }
    default:
      return error('invalid-command');
  }
}

export type IndustryTransition =
  Omit<Extract<IndustryResult, {ok: true}>, 'state'> | Extract<IndustryResult, {ok: false}>;
export interface IndustryCandidate {
  /** Isolates the command; success changes only this ephemeral candidate. Failure is atomic. */
  apply(command: IndustryCommand): IndustryTransition;
  /** Detached data for a surrounding world transaction; never the private working state. */
  snapshot(): IndustrialState;
  /** Retirement discards candidate data; it does not write or retire the surrounding world. */
  dispose(): void;
}

/**
 * One bounded, ephemeral candidate chain. Validate source/configuration once, then apply
 * caller-scheduled commands without reparsing every plan on each work tick. This is not
 * a durable stock owner: the enclosing world still owns receipts, time and publication.
 * Failed persistence discards this chain; retry uses the world's exact staged snapshot.
 */
export function createIndustryCandidate(
  raw: unknown,
  inputBounds: IndustryBounds,
  options: {maxCommands?: number} = {},
): IndustryCandidate {
  const rawBounds = rec(inputBounds),
    stock = rec(rawBounds.stock);
  const bounds: IndustryBounds = {
    stock: {
      containers: n(stock.containers, true),
      batches: n(stock.batches, true),
      positions: n(stock.positions, true),
      changes: n(stock.changes, true),
      properties: n(stock.properties, true),
    },
    deposits: n(rawBounds.deposits, true),
    plans: n(rawBounds.plans, true),
    machines: n(rawBounds.machines, true),
    maxStepTicks: n(rawBounds.maxStepTicks, true),
  };
  const maxCommands = n(options.maxCommands ?? 4096, true);
  let state: IndustrialState | undefined = parseIndustrialState(raw, bounds);
  let busy = false,
    commands = 0;
  return Object.freeze({
    apply(command: IndustryCommand): IndustryTransition {
      if (!state) return {ok: false, reason: 'retired'};
      if (busy) return {ok: false, reason: 'busy'};
      if (commands >= maxCommands) return {ok: false, reason: 'candidate-limit'};
      commands++;
      busy = true;
      try {
        const captured = captureIndustryCommand(command, bounds);
        if (!state) return {ok: false, reason: 'retired'};
        const result = prepareParsedIndustryCommand(state, captured, bounds);
        if (!state) return {ok: false, reason: 'retired'};
        if (!result.ok) return Object.freeze(result);
        const {state: next, ...transition} = result;
        state = next;
        return Object.freeze(transition);
      } catch (e) {
        if (!state) return {ok: false, reason: 'retired'};
        if (e instanceof Invalid) return {ok: false, reason: e.message};
        throw e;
      } finally {
        busy = false;
      }
    },
    snapshot(): IndustrialState {
      if (!state) throw Error('Industry candidate is retired');
      if (busy) throw Error('Industry candidate is busy');
      // Only validated, captured records can enter this private owner. Copy the
      // bounded canonical graph; reparsing every immutable plan on every observation
      // repeats admission work without strengthening the detached snapshot contract.
      const batch = (b: StockBatch): StockBatch => ({
        ...b,
        properties: Object.assign(Object.create(null), b.properties),
      });
      return {
        ...state,
        stock: {
          ...state.stock,
          containers: state.stock.containers.map(c => ({...c, phases: [...c.phases]})),
          batches: state.stock.batches.map(batch),
          positions: state.stock.positions.map(p => ({...p})),
        },
        deposits: state.deposits.map(d => ({...d})),
        machines: state.machines.map(m => ({...m})),
        plans: state.plans.map(p => ({
          ...p,
          inputs: p.inputs.map(i => ({...i})),
          outputs: p.outputs.map(o => ({...o, batch: batch(o.batch)})),
        })),
      };
    },
    dispose() {
      state = undefined;
    },
  });
}
