import {createAuthoredDocument, type DocumentValue, type DocumentLimits, type PreparedDocument} from '../authoring/document.js';
import {createRetirementInventory, type RetirementInventoryOptions, type RetirementInventorySnapshot} from '../inventory/retirement.js';
import {parseInventoryOperation, type InventoryAmount, type InventoryOutput} from '../inventory/ledger.js';

export interface MaterializationOutput {localId: string; material: string; properties: Record<string, number>; container: string; quantity: number}
export interface MaterializationDefinition {id: string; revision: number; output: MaterializationOutput}
export type MaterializationPolicy = {kind: 'frozen'; output: MaterializationOutput} | {kind: 'pinned'; definition: MaterializationDefinition} | {kind: 'current'; definitionId: string};
export type MaterializationCommand =
  | {id: string; kind: 'admit'; consume: InventoryAmount[]; policy: MaterializationPolicy}
  | {id: string; kind: 'select'; request: number; definition: MaterializationDefinition}
  | {id: string; kind: 'settle'; request: number}
  | {id: string; kind: 'cancel'; request: number}
  | {id: string; kind: 'exchange'; consume: InventoryAmount[]; produce: InventoryOutput[]}
  | {id: string; kind: 'checkpoint'}
  | {id: string; kind: 'retire'; batchIds: string[]};
export interface MaterializationSelection {definition: {id: string; revision: number} | null; output: MaterializationOutput}
export interface MaterializationRequest {serial: number; consume: InventoryAmount[]; policy: 'frozen' | 'pinned' | 'current'; definitionId: string | null; selection: MaterializationSelection | null}
export interface MaterializationReceipt {kind: MaterializationCommand['kind']; epoch: number; request: number | null; selection: MaterializationSelection | null; batchId: string | null}
export interface MaterializationSnapshot {
  version: 1; inventory: RetirementInventorySnapshot; nextRequest: number; requests: MaterializationRequest[];
  receipts: {id: string; signature: string; result: MaterializationReceipt}[];
}
export interface MaterializationOptions {inventory: RetirementInventoryOptions; initialInventory?: RetirementInventorySnapshot; maxPending: number; maxReceipts: number; limits: DocumentLimits}
export interface MaterializationCandidate {readonly kind: 'materialization-candidate'}
const copy = <T>(value: T): T => structuredClone(value);
/**
 * The owner's document only holds JSON text of a MaterializationSnapshot and `validate` checks every field before a
 * value is accepted (inside `validate`, the view is what is being checked). The snapshot interfaces have no
 * DocumentValue index signature, so the view needs the one cast.
 */
// lint:allow-unknown-cast document values are validated snapshots; interfaces lack a DocumentValue index signature
const snapshotView = (value: DocumentValue): MaterializationSnapshot => value as unknown as MaterializationSnapshot;
const safe = (v: number) => Number.isSafeInteger(v) && v >= 0;
function id(value: string): string {if (typeof value !== 'string' || !value.length || value.length > 128) throw Error('materialization: invalid ID'); return value;}
function serial(value: number): number {if (!safe(value)) throw Error('materialization: invalid counter'); return value;}
const reservation = (value: number) => `materialization-reservation:${value}`;
function output(raw: MaterializationOutput): MaterializationOutput {
  const localId = id(raw.localId);
  const op = parseInventoryOperation({kind: 'exchange', id: 'validate', consume: [], produce: [{container: raw.container, batch: {id: `0:${localId}`, material: raw.material, properties: raw.properties}, quantity: raw.quantity}]});
  if (op.kind !== 'exchange') throw Error('materialization: invalid output');
  const p = op.produce[0]!; return {localId, material: p.batch.material, properties: p.batch.properties, container: p.container, quantity: p.quantity};
}
function definition(raw: MaterializationDefinition): MaterializationDefinition {return {id: id(raw.id), revision: serial(raw.revision), output: output(raw.output)};}
function selection(raw: MaterializationDefinition): MaterializationSelection {const d = definition(raw); return {definition: {id: d.id, revision: d.revision}, output: d.output};}
function command(raw: MaterializationCommand): MaterializationCommand {
  const identity = id(raw.id);
  switch (raw.kind) {
    case 'admit': {
      const parsed = parseInventoryOperation({kind: 'reserve', id: identity, consume: raw.consume});
      if (parsed.kind !== 'reserve') throw Error('materialization: invalid consume');
      let policy: MaterializationPolicy;
      if (raw.policy.kind === 'frozen') policy = {kind: 'frozen', output: output(raw.policy.output)};
      else if (raw.policy.kind === 'pinned') policy = {kind: 'pinned', definition: definition(raw.policy.definition)};
      else if (raw.policy.kind === 'current') policy = {kind: 'current', definitionId: id(raw.policy.definitionId)};
      else throw Error('materialization: invalid policy');
      return {id: identity, kind: raw.kind, consume: parsed.consume, policy};
    }
    case 'select': return {id: identity, kind: raw.kind, request: serial(raw.request), definition: definition(raw.definition)};
    case 'settle': case 'cancel': return {id: identity, kind: raw.kind, request: serial(raw.request)};
    case 'exchange': {const op = parseInventoryOperation(raw); if (op.kind !== 'exchange') throw Error('materialization: invalid exchange'); return op;}
    case 'checkpoint': return {id: identity, kind: raw.kind};
    case 'retire': if (!Array.isArray(raw.batchIds) || raw.batchIds.some(v => typeof v !== 'string')) throw Error('materialization: invalid retirement'); return {id: identity, kind: raw.kind, batchIds: [...raw.batchIds]};
    default: throw Error('materialization: invalid command');
  }
}

/** Explicit commands only. Owns one envelope; no tick loop, catalog registry or persistence backend. */
export function createMaterializationOwner(input: MaterializationOptions, saved?: MaterializationSnapshot) {
  const options = copy(input);
  if (![options.maxPending, options.maxReceipts].every(v => Number.isSafeInteger(v) && v > 0)) throw Error('materialization: invalid bounds');
  const validate = (raw: DocumentValue): raw is DocumentValue => {
    const state = snapshotView(raw);
    if (!state || state.version !== 1 || !state.inventory || !safe(state.nextRequest) || !Array.isArray(state.requests) || state.requests.length > options.maxPending || !Array.isArray(state.receipts) || state.receipts.length > options.maxReceipts) throw Error('materialization: invalid envelope');
    const stock = createRetirementInventory(options.inventory, state.inventory);
    const active = new Map<string, InventoryAmount[]>();
    for (const op of [...stock.snapshot().checkpoint.base.operations, ...stock.snapshot().checkpoint.operations]) {
      if (op.kind === 'reserve') active.set(op.id, op.consume);
      else if (op.kind === 'release' || op.kind === 'commit') active.delete(op.reservationId);
    }
    const seen = new Set<number>();
    for (const r of state.requests) {
      if (!safe(r.serial) || r.serial >= state.nextRequest || seen.has(r.serial)) throw Error('materialization: invalid request identity'); seen.add(r.serial);
      const normalized = parseInventoryOperation({kind: 'reserve', id: reservation(r.serial), consume: r.consume});
      if (normalized.kind !== 'reserve' || JSON.stringify(active.get(normalized.id)) !== JSON.stringify(normalized.consume)) throw Error('materialization: reservation mismatch');
      active.delete(normalized.id);
      if (!['frozen', 'pinned', 'current'].includes(r.policy)) throw Error('materialization: invalid policy');
      if (r.policy === 'frozen' ? r.definitionId !== null : typeof r.definitionId !== 'string') throw Error('materialization: invalid definition identity');
      if (r.definitionId !== null) id(r.definitionId);
      if (r.selection !== null) {
        output(r.selection.output);
        if (r.policy === 'frozen') {if (r.selection.definition !== null) throw Error('materialization: unexpected definition');}
        else if (!r.selection.definition || id(r.selection.definition.id) !== r.definitionId || !safe(r.selection.definition.revision)) throw Error('materialization: definition mismatch');
      } else if (r.policy !== 'current') throw Error('materialization: missing selected output');
    }
    if (active.size) throw Error('materialization: unowned reservation');
    const receiptIds = new Set<string>();
    for (const receipt of state.receipts) {
      id(receipt.id);
      if (receiptIds.has(receipt.id) || typeof receipt.signature !== 'string') throw Error('materialization: invalid receipt'); receiptIds.add(receipt.id);
      const op = command(JSON.parse(receipt.signature) as MaterializationCommand), result = receipt.result;
      if (op.id !== receipt.id || JSON.stringify(op) !== receipt.signature || !result || result.kind !== op.kind || result.epoch !== stock.epoch || (result.request !== null && (!safe(result.request) || result.request >= state.nextRequest)) || (result.batchId !== null && typeof result.batchId !== 'string')) throw Error('materialization: invalid receipt payload');
      if (result.selection !== null) {output(result.selection.output); if (result.selection.definition !== null) {id(result.selection.definition.id); serial(result.selection.definition.revision);}}
      if ('request' in op && result.request !== op.request) throw Error('materialization: receipt request mismatch');
      if (op.kind === 'admit' ? result.request === null : !('request' in op) && result.request !== null) throw Error('materialization: invalid receipt request');
      if (op.kind === 'settle') {
        if (!result.selection || result.batchId === null) throw Error('materialization: missing settlement identity');
        const suffix = ':' + result.selection.output.localId, prefix = result.batchId.slice(0, -suffix.length), generation = Number(prefix);
        if (!result.batchId.endsWith(suffix) || !safe(generation) || String(generation) !== prefix || generation > stock.generation) throw Error('materialization: invalid settlement identity');
      } else if (result.batchId !== null) throw Error('materialization: unexpected output identity');
      if (op.kind === 'select' && JSON.stringify(result.selection) !== JSON.stringify(selection(op.definition))) throw Error('materialization: receipt selection mismatch');
      if (op.kind === 'checkpoint' || op.kind === 'retire') throw Error('materialization: boundary receipt must be pruned');
      if (op.kind === 'exchange' && result.selection !== null) throw Error('materialization: unexpected selection');
      if (op.kind === 'admit') {
        const expected = op.policy.kind === 'frozen' ? {definition: null, output: op.policy.output} : op.policy.kind === 'pinned' ? selection(op.policy.definition) : null;
        if (JSON.stringify(result.selection) !== JSON.stringify(expected)) throw Error('materialization: admission receipt mismatch');
      }
      if (op.kind === 'settle') {
        const selected = output(result.selection!.output), material = stock.material(result.batchId!);
        if (!material || material.material !== selected.material || JSON.stringify(material.properties) !== JSON.stringify(selected.properties)) throw Error('materialization: settlement material mismatch');
      }
    }
    return true;
  };
  const initial: MaterializationSnapshot = saved === undefined ? {version: 1, inventory: createRetirementInventory(options.inventory, options.initialInventory).snapshot(), nextRequest: 0, requests: [], receipts: []} : copy(saved);
  const document = createAuthoredDocument({id: 'materialization', json: JSON.stringify(initial), limits: options.limits, validate});
  let pending: {token: MaterializationCandidate; prepared: PreparedDocument<DocumentValue>; result: MaterializationReceipt; attempted: boolean} | undefined, busy = false, closed = false;
  const state = () => snapshotView(copy(document.read().value));
  const guarded = <T>(work: () => T): T => {if (busy) throw Error('materialization: reentrant mutation'); busy = true; try {return work();} finally {busy = false;}};
  const rejected = (reason: string) => ({status: 'rejected' as const, reason});
  return {
    snapshot: state,
    get epoch() {return snapshotView(document.read().value).inventory.checkpoint.epoch;},
    prepare(epoch: number, raw: MaterializationCommand) {
      return guarded(() => {
        if (closed) return rejected('retired');
        if (pending) return rejected('publication-pending');
        const before = state(); serial(epoch);
        if (epoch !== before.inventory.checkpoint.epoch) return rejected('stale-epoch');
        const op = command(copy(raw)), signature = JSON.stringify(op), old = before.receipts.find(r => r.id === op.id);
        if (old) return old.signature === signature ? {status: 'duplicate' as const, result: copy(old.result)} : rejected('conflict');
        if (before.receipts.length >= options.maxReceipts && op.kind !== 'checkpoint' && op.kind !== 'retire') return rejected('checkpoint-required');
        const stock = createRetirementInventory(options.inventory, before.inventory), operationId = `materialization:${epoch}:${op.id}`;
        let result: MaterializationReceipt = {kind: op.kind, epoch, request: null, selection: null, batchId: null};
        let boundary = false;
        if (op.kind === 'admit') {
          if (before.requests.length >= options.maxPending) return rejected('pending-full');
          if (before.nextRequest === Number.MAX_SAFE_INTEGER) return rejected('request-counter-exhausted');
          const request = before.nextRequest;
          const accepted = stock.apply(epoch, {kind: 'reserve', id: reservation(request), consume: op.consume});
          if (!accepted.ok) return rejected(accepted.reason);
          if (accepted.duplicate) return rejected('conflict');
          const selected = op.policy.kind === 'frozen' ? {definition: null, output: op.policy.output} : op.policy.kind === 'pinned' ? selection(op.policy.definition) : null;
          before.requests.push({serial: request, consume: op.consume, policy: op.policy.kind, definitionId: op.policy.kind === 'frozen' ? null : op.policy.kind === 'pinned' ? op.policy.definition.id : op.policy.definitionId, selection: selected});
          before.nextRequest++; result = {...result, request, selection: selected};
        } else if (op.kind === 'select' || op.kind === 'settle' || op.kind === 'cancel') {
          const request = before.requests.find(r => r.serial === op.request);
          if (!request) return rejected('unknown-request');
          if (op.kind === 'select') {
            if (request.policy !== 'current' || request.selection) return rejected('already-selected');
            if (op.definition.id !== request.definitionId) return rejected('definition-mismatch');
            request.selection = selection(op.definition);
          } else {
            if (op.kind === 'settle' && !request.selection) return rejected('selection-required');
            const selected = request.selection;
            const batchId = selected && op.kind === 'settle' ? stock.qualify(selected.output.localId) : null;
            const accepted = op.kind === 'cancel' ? stock.apply(epoch, {kind: 'release', id: operationId, reservationId: reservation(request.serial)}) : stock.apply(epoch, {kind: 'commit', id: operationId, reservationId: reservation(request.serial), produce: [{container: selected!.output.container, quantity: selected!.output.quantity, batch: {id: batchId!, material: selected!.output.material, properties: selected!.output.properties}}]});
            if (!accepted.ok) return rejected(accepted.reason);
          if (accepted.duplicate) return rejected('conflict');
            before.requests = before.requests.filter(r => r.serial !== request.serial); result.batchId = batchId;
          }
          result.request = request.serial; result.selection = request.selection;
        } else if (op.kind === 'exchange') {
          const accepted = stock.apply(epoch, {...op, id: operationId}); if (!accepted.ok) return rejected(accepted.reason);
          if (accepted.duplicate) return rejected('conflict');
        } else {
          if (op.kind === 'checkpoint') stock.checkpoint();
          else {const accepted = stock.retire(op.batchIds); if (!accepted.ok) return rejected(accepted.reason);}
          before.receipts = []; boundary = true; result.epoch = stock.epoch;
        }
        before.inventory = stock.snapshot();
        if (!boundary) before.receipts.push({id: op.id, signature, result});
        const staged = document.prepare(document.read().ticket, () => JSON.stringify(before));
        if (staged.status !== 'prepared') return rejected(staged.status);
        const token: MaterializationCandidate = Object.freeze({kind: 'materialization-candidate'});
        pending = {token, prepared: staged.candidate, result, attempted: false};
        return {status: 'prepared' as const, candidate: token, result: copy(result)};
      });
    },
    /** Callback must accept this entire envelope; false/throw retains the exact candidate for retry. */
    publish(candidate: MaterializationCandidate, accept: (snapshot: MaterializationSnapshot) => boolean = () => true) {
      return guarded(() => {
        if (!pending || pending.token !== candidate) return rejected('stale-candidate');
        const staged = pending; staged.attempted = true;
        if (accept(snapshotView(copy(staged.prepared.value))) !== true) return {status: 'pending' as const};
        const accepted = document.publish(staged.prepared);
        if (accepted.status !== 'accepted') return rejected(accepted.status);
        pending = undefined; return {status: 'accepted' as const, result: copy(staged.result)};
      });
    },
    discard(candidate: MaterializationCandidate) {return guarded(() => {if (!pending || pending.token !== candidate || pending.attempted) return false; document.discard(pending.prepared); pending = undefined; return true;});},
    close() {guarded(() => {closed = true; if (pending) document.discard(pending.prepared); pending = undefined; document.dispose();});},
  };
}
