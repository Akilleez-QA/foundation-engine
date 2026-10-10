/** Behaviour tree definitions: plain data validated into a frozen, flat node table. */

export class BehaviorError extends Error {
  constructor(message: string) {
    super(`behavior: ${message}`);
    this.name = 'BehaviorError';
  }
}

/** Blackboard values: JSON scalars. */
export type BlackboardValue = number | string | boolean | null;
export type CompareOp = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'exists' | 'missing';

/**
 * A node. Composites: `sequence`, `selector` (resume at the running child; `reactive: true` re-evaluates from the
 * first child every tick and aborts a running child that is no longer reached), `parallel` (`succeed`/`fail`:
 * 'all' | 'any'), `shuffle` (a selector whose order is drawn from the random source at each activation, with
 * optional weights). Decorators: `invert`, `succeed`, `fail`, `repeat` (`times`, or null to repeat until the child
 * fails; one child run per tick), `retry` (`times`), `timeout` (`ticks`), `cooldown` (`ticks` after the child
 * finishes), `guard` (a condition re-checked every tick; false aborts the child). Leaves: `action` and `condition`
 * call creator handlers by name, `wait` (`ticks`), `set` (write a blackboard key), `check` (compare a blackboard key).
 * Every node may carry a `name` for traces.
 */
export type NodeInput = Readonly<
  {name?: string} & (
    | {type: 'sequence' | 'selector'; children: readonly NodeInput[]; reactive?: boolean}
    | {type: 'parallel'; children: readonly NodeInput[]; succeed?: 'all' | 'any'; fail?: 'all' | 'any'}
    | {type: 'shuffle'; children: readonly NodeInput[]; weights?: readonly number[]}
    | {type: 'invert' | 'succeed' | 'fail'; child: NodeInput}
    | {type: 'repeat'; child: NodeInput; times: number | null}
    | {type: 'retry'; child: NodeInput; times: number}
    | {type: 'timeout' | 'cooldown'; child: NodeInput; ticks: number}
    | {type: 'guard'; check: string; args?: BlackboardValue; child: NodeInput}
    | {type: 'action'; action: string; args?: BlackboardValue}
    | {type: 'condition'; check: string; args?: BlackboardValue}
    | {type: 'wait'; ticks: number}
    | {type: 'set'; key: string; value: BlackboardValue}
    | {type: 'check'; key: string; op: CompareOp; value?: BlackboardValue}
  )
>;

export interface FlatNode {
  readonly index: number;
  readonly type: NodeInput['type'];
  readonly name: string | null;
  readonly children: readonly number[];
  readonly reactive: boolean;
  readonly succeed: 'all' | 'any';
  readonly fail: 'all' | 'any';
  readonly weights: readonly number[] | null;
  readonly times: number | null;
  readonly ticks: number;
  readonly handler: string | null;
  readonly args: BlackboardValue;
  readonly key: string | null;
  readonly op: CompareOp | null;
  readonly value: BlackboardValue;
}
export interface BehaviorTree {
  readonly nodes: readonly FlatNode[];
  readonly actions: readonly string[];
  readonly conditions: readonly string[];
  /** Stable text of the normalised tree; snapshots record it and restore refuses a different tree. */
  readonly signature: string;
}

const NAME = /^[A-Za-z0-9_.:-]{1,64}$/;
export const isBehaviorName = (v: unknown): v is string => typeof v === 'string' && NAME.test(v);
const MAX_TICKS = 2 ** 40;

export function isBlackboardValue(v: unknown): v is BlackboardValue {
  return (
    v === null ||
    typeof v === 'boolean' ||
    (typeof v === 'number' && Number.isFinite(v)) ||
    (typeof v === 'string' && v.length <= 1024)
  );
}

function record(value: unknown, allowed: readonly string[], what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BehaviorError(`${what} must be a record`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new BehaviorError(`${what} must be plain data`);
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key))
      throw new BehaviorError(`${what} has unexpected field ${String(key)}`);
    const d = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in d)) throw new BehaviorError(`${what} has an accessor`);
    out[key] = d.value;
  }
  return out;
}
function list(value: unknown, max: number, what: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    throw new BehaviorError(`${what} must be an array`);
  const length: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (typeof length !== 'number' || length > max) throw new BehaviorError(`${what} has more than ${max} entries`);
  if (Reflect.ownKeys(value).length !== length + 1) throw new BehaviorError(`${what} must be dense data`);
  const out: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !('value' in d)) throw new BehaviorError(`${what} must hold data`);
    out.push(d.value);
  }
  return out;
}
const int = (v: unknown, min: number, max: number, what: string): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max)
    throw new BehaviorError(`${what} must be an integer in ${min}..${max}`);
  return v;
};
const name = (v: unknown, what: string): string => {
  if (!isBehaviorName(v)) throw new BehaviorError(`invalid ${what} ${JSON.stringify(v)}`);
  return v;
};
const scalar = (v: unknown, what: string): BlackboardValue => {
  if (v === undefined) return null;
  if (!isBlackboardValue(v)) throw new BehaviorError(`${what} must be a finite number, string ≤ 1024, boolean or null`);
  return v;
};

const FIELDS: Record<NodeInput['type'], readonly string[]> = {
  sequence: ['children', 'reactive'],
  selector: ['children', 'reactive'],
  parallel: ['children', 'succeed', 'fail'],
  shuffle: ['children', 'weights'],
  invert: ['child'],
  succeed: ['child'],
  fail: ['child'],
  repeat: ['child', 'times'],
  retry: ['child', 'times'],
  timeout: ['child', 'ticks'],
  cooldown: ['child', 'ticks'],
  guard: ['check', 'args', 'child'],
  action: ['action', 'args'],
  condition: ['check', 'args'],
  wait: ['ticks'],
  set: ['key', 'value'],
  check: ['key', 'op', 'value'],
};
const OPS: readonly CompareOp[] = ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'exists', 'missing'];

/** Validate a tree (default ≤ 1,024 nodes, depth ≤ 64, ≤ 64 children per composite) into a flat frozen table. */
export function defineBehaviorTree(root: NodeInput, limits: {maxNodes?: number; maxDepth?: number} = {}): BehaviorTree {
  const maxNodes = int(limits.maxNodes ?? 1024, 1, 16384, 'maxNodes');
  const maxDepth = int(limits.maxDepth ?? 64, 1, 256, 'maxDepth');
  const nodes: FlatNode[] = [];
  const actions = new Set<string>(),
    conditions = new Set<string>();
  const visit = (raw: unknown, depth: number): number => {
    if (depth > maxDepth) throw new BehaviorError('tree is too deep');
    if (nodes.length >= maxNodes) throw new BehaviorError('tree has too many nodes');
    const head = record(raw, ['type', 'name', ...Object.values(FIELDS).flat()], 'node');
    const type = head.type as NodeInput['type'];
    if (typeof type !== 'string' || !Object.hasOwn(FIELDS, type))
      throw new BehaviorError(`unknown node type ${String(type)}`);
    const n = record(raw, ['type', 'name', ...FIELDS[type]], `${type} node`);
    const index = nodes.length;
    const node: {-readonly [K in keyof FlatNode]: FlatNode[K]} = {
      index,
      type,
      name: n.name === undefined ? null : name(n.name, 'node name'),
      children: [],
      reactive: false,
      succeed: 'all',
      fail: 'any',
      weights: null,
      times: null,
      ticks: 0,
      handler: null,
      args: null,
      key: null,
      op: null,
      value: null,
    };
    nodes.push(node);
    const children: number[] = [];
    if ('children' in n) {
      const items = list(n.children, 64, `${type} children`);
      if (!items.length) throw new BehaviorError(`${type} needs at least one child`);
      for (const item of items) children.push(visit(item, depth + 1));
    }
    if ('child' in n) children.push(visit(n.child, depth + 1));
    const composite = type === 'sequence' || type === 'selector' || type === 'parallel' || type === 'shuffle';
    const decorator = FIELDS[type].includes('child');
    if (composite && !children.length) throw new BehaviorError(`${type} needs children`);
    if (decorator && children.length !== 1) throw new BehaviorError(`${type} needs a child`);
    node.children = Object.freeze(children);
    switch (type) {
      case 'sequence':
      case 'selector':
        if (n.reactive !== undefined && typeof n.reactive !== 'boolean')
          throw new BehaviorError('reactive must be boolean');
        node.reactive = n.reactive === true;
        break;
      case 'parallel':
        for (const k of ['succeed', 'fail'] as const)
          if (n[k] !== undefined && n[k] !== 'all' && n[k] !== 'any')
            throw new BehaviorError(`parallel ${k} must be all or any`);
        node.succeed = (n.succeed as 'all' | 'any' | undefined) ?? 'all';
        node.fail = (n.fail as 'all' | 'any' | undefined) ?? 'any';
        break;
      case 'shuffle':
        if (n.weights !== undefined) {
          const w = list(n.weights, 64, 'weights');
          if (w.length !== children.length || !w.every(x => typeof x === 'number' && Number.isFinite(x) && x > 0))
            throw new BehaviorError('shuffle weights must be one positive finite number per child');
          node.weights = Object.freeze(w as number[]);
        }
        break;
      case 'repeat':
        node.times = n.times === null ? null : int(n.times, 1, 1_000_000, 'repeat times');
        break;
      case 'retry':
        node.times = int(n.times, 1, 1_000_000, 'retry times');
        break;
      case 'timeout':
      case 'cooldown':
      case 'wait':
        node.ticks = int(n.ticks, type === 'cooldown' ? 0 : 1, MAX_TICKS, `${type} ticks`);
        break;
      case 'guard':
      case 'condition':
        node.handler = name(n.check, `${type} check`);
        node.args = scalar(n.args, 'args');
        conditions.add(node.handler);
        break;
      case 'action':
        node.handler = name(n.action, 'action');
        node.args = scalar(n.args, 'args');
        actions.add(node.handler);
        break;
      case 'set':
        node.key = name(n.key, 'blackboard key');
        node.value = scalar(n.value, 'value');
        break;
      case 'check':
        node.key = name(n.key, 'blackboard key');
        if (!OPS.includes(n.op as CompareOp)) throw new BehaviorError(`invalid compare op ${String(n.op)}`);
        node.op = n.op as CompareOp;
        node.value = scalar(n.value, 'value');
        break;
    }
    Object.freeze(node);
    return index;
  };
  visit(root, 1);
  const frozen = Object.freeze(nodes as FlatNode[]);
  return Object.freeze({
    nodes: frozen,
    actions: Object.freeze([...actions].sort()),
    conditions: Object.freeze([...conditions].sort()),
    signature: JSON.stringify(frozen),
  });
}
