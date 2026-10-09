// Experimental shared reverse field. Not a kit export or a replacement for route ownership.
import {prepareNavigationGraph} from '../../src/kits/navigation/search.ts';

export function prepareFieldTopology(graph, revision) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw Error('invalid revision');
  const snapshot = prepareNavigationGraph(graph);
  const ids = snapshot.nodes.map(n => n.id);
  const indices = new Map(ids.map((id, i) => [id, i]));
  const incoming = ids.map(() => []);
  for (let from = 0; from < ids.length; from++)
    for (const edge of snapshot.nodes[from].edges) {
      if (!Number.isSafeInteger(edge.cost)) throw Error('lab requires nonnegative safe integer edge costs');
      incoming[indices.get(edge.to)].push(Object.freeze({from, cost: edge.cost}));
    }
  return Object.freeze({revision, ids: Object.freeze(ids), incoming: Object.freeze(incoming.map(Object.freeze))});
}

export function createReverseField(topology, goal) {
  const n = topology.ids.length,
    target = topology.ids.indexOf(goal);
  if (target < 0) throw Error('unknown goal');
  const distance = new Float64Array(n).fill(Infinity);
  const next = new Int32Array(n).fill(-1);
  const settled = new Uint8Array(n);
  const positions = new Int32Array(n).fill(-1);
  const heap = new Int32Array(n);
  let size = 0,
    active = -1,
    edgeIndex = 0,
    status = 'pending';
  const less = (a, b) => distance[a] < distance[b] || (distance[a] === distance[b] && a < b);
  const swap = (a, b) => {
    const t = heap[a];
    heap[a] = heap[b];
    heap[b] = t;
    positions[heap[a]] = a;
    positions[heap[b]] = b;
  };
  const offer = node => {
    let at = positions[node];
    if (at < 0) {
      at = size++;
      heap[at] = node;
      positions[node] = at;
    }
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!less(heap[at], heap[parent])) break;
      swap(at, parent);
      at = parent;
    }
  };
  const take = () => {
    const node = heap[0];
    positions[node] = -1;
    size--;
    if (size) {
      heap[0] = heap[size];
      positions[heap[0]] = 0;
      let at = 0;
      while (at * 2 + 1 < size) {
        let child = at * 2 + 1;
        if (child + 1 < size && less(heap[child + 1], heap[child])) child++;
        if (!less(heap[child], heap[at])) break;
        swap(at, child);
        at = child;
      }
    }
    return node;
  };
  distance[target] = 0;
  offer(target);
  return {
    get status() {
      return status;
    },
    // Exact algorithm typed buffers only; topology, JS objects and runtime overhead excluded.
    typedBytes: distance.byteLength + next.byteLength + settled.byteLength + positions.byteLength + heap.byteLength,
    cancel() {
      if (status === 'pending') {
        status = 'cancelled';
        size = 0;
        active = -1;
      }
    },
    step(budget) {
      if (!Number.isSafeInteger(budget) || budget < 0) throw Error('invalid work budget');
      let work = 0;
      while (work < budget && status === 'pending') {
        work++;
        if (active >= 0) {
          const edge = topology.incoming[active][edgeIndex++];
          if (edge) {
            const cost = distance[active] + edge.cost;
            if (!Number.isSafeInteger(cost)) {
              status = 'failed';
              throw Error('cost overflow');
            }
            if (!settled[edge.from] && cost < distance[edge.from]) {
              distance[edge.from] = cost;
              next[edge.from] = active;
              offer(edge.from);
            }
          }
          if (edgeIndex >= topology.incoming[active].length) active = -1;
        } else if (!size) status = 'ready';
        else {
          active = take();
          settled[active] = 1;
          edgeIndex = 0;
        }
      }
      return {status, work};
    },
    route(start, revision) {
      if (revision !== topology.revision) return {status: 'stale'};
      if (status !== 'ready') return {status};
      let at = topology.ids.indexOf(start);
      if (at < 0) throw Error('unknown start');
      if (!Number.isFinite(distance[at])) return {status: 'no-route'};
      const cost = distance[at],
        path = [];
      for (let count = 0; count <= n; count++) {
        path.push(topology.ids[at]);
        if (at === target) return {status: 'arrived', cost, path};
        at = next[at];
        if (at < 0) break;
      }
      throw Error('invalid successor chain');
    },
  };
}
