const prepared = new WeakSet<NavigationGraph>();
export interface NavigationEdge { readonly to: string; readonly cost: number }
export interface NavigationNode { readonly id: string; readonly edges: readonly NavigationEdge[] }
export interface NavigationGraph { readonly nodes: readonly NavigationNode[] }

/** Copy and validate once during preparation, never on each frame. Directed edges. */
export function createNavigationGraph(nodes: readonly NavigationNode[]): NavigationGraph {
  if (nodes.length > 8192 || nodes.reduce((n, node) => n + node.edges.length, 0) > 65536) throw Error('navigation: topology budget exceeded');
  const ids = new Set<string>();
  for (const node of nodes) {
    if (typeof node.id !== 'string' || !node.id || ids.has(node.id)) throw new Error('navigation: invalid or duplicate node id');
    ids.add(node.id);
  }
  const copy = nodes.map(node => {
    const neighbors = new Set<string>();
    const edges = node.edges.map(edge => {
      if (!ids.has(edge.to) || neighbors.has(edge.to) || !Number.isFinite(edge.cost) || edge.cost < 0) throw new Error('navigation: invalid edge');
      neighbors.add(edge.to);
      return Object.freeze({ to: edge.to, cost: edge.cost });
    }).sort((a, b) => a.to < b.to ? -1 : a.to > b.to ? 1 : 0);
    return Object.freeze({ id: node.id, edges: Object.freeze(edges) });
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const graph = Object.freeze({ nodes: Object.freeze(copy) }); prepared.add(graph); return graph;
}

/** Internal prepared-graph boundary, also used before queue ownership. */
export function prepareNavigationGraph(graph:NavigationGraph):NavigationGraph {return prepared.has(graph)?graph:createNavigationGraph(graph.nodes);}

export type PathResult = Readonly<{ status: 'pending' | 'no-route' | 'cancelled' }> |
  Readonly<{ status: 'arrived'; path: readonly string[]; cost: number }>;
export interface PathStep { readonly result: PathResult; readonly work: number }
export interface PathSearch {
  readonly result: PathResult;
  /** One unit selects a node, examines an edge, or reconstructs one path entry. */
  step(maxWork: number): PathStep;
  cancel(): void;
}

/**
 * Incremental A*. Defaults to zero heuristic (Dijkstra). Optional estimates must be
 * finite, nonnegative, goal-zero and consistent across every directed edge.
 * Request preparation copies/validates topology and estimates in O(V + E log E).
 * No graph marks or mutable state are shared between requests.
 */
export function createPathSearch(graph: NavigationGraph, start: string, goal: string, estimates: Readonly<Record<string, number>> = {}): PathSearch {
  // Accept structural callers safely, not just graphs constructed by our factory.
  const snapshot = prepareNavigationGraph(graph);
  const nodes = new Map(snapshot.nodes.map(node => [node.id, node]));
  if (!nodes.has(start) || !nodes.has(goal)) throw new Error('navigation: unknown endpoint');
  const h = new Map(snapshot.nodes.map(node => [node.id, Object.hasOwn(estimates, node.id) ? estimates[node.id]! : 0]));
  for (const [id, value] of h) {
    if (!Number.isFinite(value) || value < 0 || (id === goal && value !== 0)) throw new Error('navigation: invalid estimate');
    for (const edge of nodes.get(id)!.edges) if (value > edge.cost + h.get(edge.to)!) throw new Error('navigation: inconsistent estimate');
  }
  const costs = new Map<string, number>([[start, 0]]), parents = new Map<string, string>();
  const heap: string[] = [], slots = new Map<string, number>(), closed = new Set<string>();
  const less = (a: string, b: string): boolean => {
    const fa = costs.get(a)! + h.get(a)!, fb = costs.get(b)! + h.get(b)!;
    return fa < fb || (fa === fb && a < b);
  };
  const swap = (a: number, b: number): void => {
    const first = heap[a]!; heap[a] = heap[b]!; heap[b] = first;
    slots.set(heap[a]!, a); slots.set(heap[b]!, b);
  };
  const offer = (id: string): void => {
    const existing = slots.get(id);
    let i: number = existing ?? heap.length;
    if (existing === undefined) { heap.push(id); slots.set(id, i); }
    while (i > 0) { const p = (i - 1) >> 1; if (!less(heap[i]!, heap[p]!)) break; swap(i, p); i = p; }
  };
  const take = (): string => {
    const id = heap[0]!, last = heap.pop()!; slots.delete(id);
    if (heap.length) {
      heap[0] = last; slots.set(last, 0); let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && less(heap[child + 1]!, heap[child]!)) child++;
        if (!less(heap[child]!, heap[i]!)) break;
        swap(i, child); i = child;
      }
    }
    return id;
  };
  offer(start);
  let result: PathResult = Object.freeze({ status: 'pending' });
  let active: NavigationNode | undefined, edgeIndex = 0;
  let reconstruct: string | undefined, copying = false, copyIndex = -1;
  const reverse: string[] = [], path: string[] = [];
  const release = (): void => { heap.length = 0; slots.clear(); costs.clear(); parents.clear(); closed.clear(); nodes.clear(); h.clear(); active = undefined; reverse.length = 0; };
  return {
    get result() { return result; },
    cancel() { if (result.status === 'pending') { result = Object.freeze({ status: 'cancelled' }); release(); } },
    step(maxWork) {
      if (!Number.isSafeInteger(maxWork) || maxWork < 0) throw new RangeError('navigation: work budget must be a nonnegative integer');
      let work = 0;
      while (work < maxWork && result.status === 'pending') {
        work++;
        if (copying) {
          path.push(reverse[copyIndex--]!);
          if (copyIndex < 0) { result = Object.freeze({ status: 'arrived', path: Object.freeze(path), cost: costs.get(goal)! }); release(); }
        } else if (reconstruct !== undefined) {
          reverse.push(reconstruct);
          if (reconstruct === start) { reconstruct = undefined; copying = true; copyIndex = reverse.length - 1; }
          else reconstruct = parents.get(reconstruct)!;
        } else if (active) {
          const edge = active.edges[edgeIndex++];
          if (edge) {
            const cost = costs.get(active.id)! + edge.cost;
            if (!Number.isFinite(cost) || !Number.isFinite(cost + h.get(edge.to)!)) {
              result = Object.freeze({ status: 'cancelled' }); release();
              throw new RangeError('navigation: path cost or priority overflow');
            }
            if (!closed.has(edge.to) && cost < (costs.get(edge.to) ?? Infinity)) {
              costs.set(edge.to, cost); parents.set(edge.to, active.id); offer(edge.to);
            }
          }
          if (edgeIndex >= active.edges.length) active = undefined;
        } else if (!heap.length) { result = Object.freeze({ status: 'no-route' }); release(); }
        else {
          const id = take(); closed.add(id);
          if (id === goal) reconstruct = goal;
          else { active = nodes.get(id)!; edgeIndex = 0; }
        }
      }
      return Object.freeze({ result, work });
    },
  };
}
