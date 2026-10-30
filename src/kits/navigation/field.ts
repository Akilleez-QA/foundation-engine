import {prepareNavigationGraph, type NavigationGraph} from './search';

export type DistanceLabel =
  | Readonly<{status: 'unreachable'}>
  | Readonly<{status: 'goal'; distance: 0; rank: number}>
  | Readonly<{status: 'reachable'; distance: number; next: string; rank: number}>;
export interface NavigationField {
  readonly graph: NavigationGraph;
  readonly goals: readonly string[];
  /** Unknown node IDs return null. Reachable next hops strictly decrease settlement rank. */
  get(id: string): DistanceLabel | null;
}
export type FieldResult =
  Readonly<{status: 'pending' | 'cancelled'}> | Readonly<{status: 'complete'; field: NavigationField}>;
export type FieldPhase = 'index' | 'reverse' | 'seed' | 'search' | 'publish' | 'terminal';
export interface FieldSearch {
  readonly result: FieldResult;
  readonly phase: FieldPhase;
  /** Logical node, edge, heap selection or output-row work; heap operations cost O(log V). */
  step(maxWork: number): Readonly<{result: FieldResult; work: number}>;
  /** Only pending construction is cancelled; completed immutable data remains valid as a snapshot. */
  cancel(): void;
}

/** Shared distances to any supplied goal over directed, nonnegative weighted topology.
 * Graph admission, node lookup/storage and goal validation are synchronous O(V + G log G)
 * after existing graph preparation. Reverse adjacency, search and publication are incremental.
 * No callbacks, scheduling, cache or accepted-world authority are owned here. */
export function createDistanceField(graph: NavigationGraph, inputGoals: readonly string[]): FieldSearch {
  const snapshot = prepareNavigationGraph(graph);
  const goalCount = Array.isArray(inputGoals) ? inputGoals.length : 0;
  if (!Number.isSafeInteger(goalCount) || goalCount < 1 || goalCount > snapshot.nodes.length)
    throw new RangeError('navigation: invalid field goal count');
  const nodes = snapshot.nodes;
  const indices = new Map(nodes.map((node, i) => [node.id, i]));
  const goals: string[] = [];
  const unique = new Set<string>();
  for (let i = 0; i < goalCount; i++) {
    const id = inputGoals[i]!;
    if (typeof id !== 'string' || !indices.has(id) || unique.has(id))
      throw new Error('navigation: unknown or duplicate field goal');
    unique.add(id);
    goals.push(id);
  }
  goals.sort();
  const goalIds = Object.freeze(goals);
  unique.clear();
  let distance = new Float64Array(nodes.length).fill(Infinity);
  let next = new Int32Array(nodes.length).fill(-1);
  let rank = new Int32Array(nodes.length).fill(-1);
  let slots = new Int32Array(nodes.length).fill(-1);
  const incoming: {from: number; cost: number}[][] = [];
  const heap: number[] = [];
  let labels = new Map<string, DistanceLabel>();
  let result: FieldResult = Object.freeze({status: 'pending'});
  let phase: FieldPhase = 'index';
  let cursor = 0,
    edgeIndex = 0,
    active = -1,
    serial = 0;
  const less = (a: number, b: number) => distance[a]! < distance[b]! || (distance[a] === distance[b] && a < b);
  const swap = (a: number, b: number) => {
    const first = heap[a]!;
    heap[a] = heap[b]!;
    heap[b] = first;
    slots[heap[a]!] = a;
    slots[heap[b]!] = b;
  };
  const offer = (node: number) => {
    let i = slots[node]!;
    if (i < 0) {
      i = heap.length;
      heap.push(node);
      slots[node] = i;
    }
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!less(heap[i]!, heap[parent]!)) break;
      swap(i, parent);
      i = parent;
    }
  };
  const take = () => {
    const node = heap[0]!,
      last = heap.pop()!;
    slots[node] = -1;
    if (heap.length) {
      heap[0] = last;
      slots[last] = 0;
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && less(heap[child + 1]!, heap[child]!)) child++;
        if (!less(heap[child]!, heap[i]!)) break;
        swap(i, child);
        i = child;
      }
    }
    return node;
  };
  const release = () => {
    indices.clear();
    incoming.length = 0;
    heap.length = 0;
    distance = new Float64Array(0);
    next = new Int32Array(0);
    rank = new Int32Array(0);
    slots = new Int32Array(0);
    labels = new Map();
    active = -1;
    phase = 'terminal';
  };
  const cancel = () => {
    if (result.status !== 'pending') return;
    result = Object.freeze({status: 'cancelled'});
    release();
  };
  return {
    get result() {
      return result;
    },
    get phase() {
      return phase;
    },
    cancel,
    step(maxWork) {
      if (!Number.isSafeInteger(maxWork) || maxWork < 0)
        throw new RangeError('navigation: field work must be a nonnegative safe integer');
      let work = 0;
      while (work < maxWork && result.status === 'pending') {
        work++;
        if (phase === 'index') {
          incoming.push([]);
          if (++cursor === nodes.length) {
            cursor = 0;
            phase = 'reverse';
          }
        } else if (phase === 'reverse') {
          const edge = nodes[cursor]!.edges[edgeIndex++];
          if (edge) incoming[indices.get(edge.to)!]!.push({from: cursor, cost: edge.cost});
          if (edgeIndex >= nodes[cursor]!.edges.length) {
            edgeIndex = 0;
            if (++cursor === nodes.length) {
              cursor = 0;
              phase = 'seed';
            }
          }
        } else if (phase === 'seed') {
          const node = indices.get(goalIds[cursor++]!)!;
          distance[node] = 0;
          offer(node);
          if (cursor === goalIds.length) {
            cursor = 0;
            phase = 'search';
          }
        } else if (phase === 'search') {
          if (active >= 0) {
            const edge = incoming[active]![edgeIndex++];
            if (edge && rank[edge.from]! < 0) {
              const cost = edge.cost + distance[active]!;
              if (!Number.isFinite(cost)) {
                cancel();
                throw new RangeError('navigation: field cost overflow');
              }
              if (cost < distance[edge.from]!) {
                distance[edge.from] = cost;
                next[edge.from] = active;
                offer(edge.from);
              }
            }
            if (edgeIndex >= incoming[active]!.length) active = -1;
          } else if (heap.length) {
            active = take();
            rank[active] = serial++;
            edgeIndex = 0;
          } else {
            cursor = 0;
            phase = 'publish';
          }
        } else if (phase === 'publish') {
          const id = nodes[cursor]!.id;
          const label: DistanceLabel =
            rank[cursor]! < 0
              ? {status: 'unreachable'}
              : next[cursor]! < 0
                ? {status: 'goal', distance: 0, rank: rank[cursor]!}
                : {
                    status: 'reachable',
                    distance: distance[cursor]!,
                    next: nodes[next[cursor]!]!.id,
                    rank: rank[cursor]!,
                  };
          labels.set(id, Object.freeze(label));
          if (++cursor === nodes.length) {
            const completed = labels;
            const field: NavigationField = Object.freeze({
              graph: snapshot,
              goals: goalIds,
              get: (id: string) => completed.get(id) ?? null,
            });
            result = Object.freeze({status: 'complete', field});
            release();
          }
        }
      }
      return Object.freeze({result, work});
    },
  };
}
