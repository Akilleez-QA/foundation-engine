// Reference composition (tools only, in-process, no sockets): SC-01 spatial grid + SC-02 interest sets feeding one
// NW-02 complete scoped view publisher per connection. It shows the wiring a creator's authoritative host would use;
// the field projection, radii, budgets and identities are fixture policy, not engine schema.
//
//   node --import tsx tools/interest-host/host.mjs        (prints a short demonstration transcript)
import { pathToFileURL } from 'node:url';
import { createInterestResult, createInterestSets, createSpatialGrid } from '../../src/kits/spatial/index.ts';
import { createViewPublisher } from '../../src/kits/network/index.ts';

/**
 * @param {{ grid: import('../../src/kits/spatial/index.ts').GridLimits,
 *           interest: import('../../src/kits/spatial/index.ts').InterestLimits,
 *           view: import('../../src/kits/network/index.ts').ViewLimits,
 *           fields?: (id: number, entity: {x: number, y: number, kind: string}) => unknown }} config
 */
export function createInterestHost(config) {
  const { view } = config;
  if (config.interest.maxRelevant > view.maxEntities) throw new RangeError('interest host: maxRelevant must not exceed the view maxEntities');
  const fields = config.fields ?? ((_, e) => ({ x: Math.round(e.x * 100) / 100, y: Math.round(e.y * 100) / 100, kind: e.kind }));
  const grid = createSpatialGrid(config.grid);
  const interest = createInterestSets(grid, config.interest);
  const result = createInterestResult(config.interest);
  const ranked = new Float64Array(config.interest.maxRelevant);
  /** Authoritative entity state; incarnation advances when an id is reused. */
  const entities = new Map(), incarnations = new Map();
  const connections = new Map();
  let worldRevision = 0, nextObserver = 1;

  const host = {
    spawn(id, x, y, kind = 'unit') {
      const status = grid.insert(id, x, y);
      if (status !== 'inserted') return status;
      incarnations.set(id, (incarnations.get(id) ?? -1) + 1);
      entities.set(id, { x, y, kind, rev: ++worldRevision });
      return status;
    },
    move(id, x, y) {
      const e = entities.get(id);
      if (!e) return 'absent';
      const status = grid.move(id, x, y);
      if (status === 'out-of-bounds') { host.despawn(id); return status; } // never leave a stale indexed position
      e.x = x; e.y = y; e.rev = ++worldRevision;
      return status;
    },
    despawn(id) {
      if (!entities.delete(id)) return 'absent';
      grid.remove(id); worldRevision++;
      return 'removed';
    },
    /** One authenticated connection: an observer plus its own complete-view publisher. `send` is the transport. */
    connect(session, x, y, send, self) {
      // One live view per session: a reconnect must disconnect the old one first (no leaked observer slot).
      if (connections.has(session)) return { status: 'duplicate' };
      const observer = nextObserver++;
      const added = interest.addObserver(observer, x, y, self);
      if (added !== 'added') return { status: added };
      const record = { observer, session, live: true, frames: 0, checkedAt: worldRevision, viewRevision: 0 };
      try {
        record.publisher = createViewPublisher({ session, limits: view, ports: {
        current: () => record.live,
        project: () => {
          const n = interest.members(observer, ranked), rows = [];
          for (let i = 0; i < n; i++) {
            const id = ranked[i], e = entities.get(id);
            if (e) rows.push({ id: String(id), incarnation: incarnations.get(id), fields: fields(id, e) });
          }
          // Per-connection revision: a global counter would reveal activity outside this connection's interest.
          return JSON.stringify({ worldRevision: record.viewRevision, entities: rows });
        },
        send: json => { record.frames++; return send(json); },
        retire: () => { record.live = false; interest.removeObserver(observer); connections.delete(session); },
        } });
      } catch (error) {
        interest.removeObserver(observer); // a refused publisher (e.g. an invalid session) must not keep the slot
        throw error;
      }
      connections.set(session, record);
      return { status: 'connected', observer };
    },
    moveObserver(session, x, y) { const c = connections.get(session); return c ? interest.moveObserver(c.observer, x, y) : 'absent'; },
    ack(session, sequence) { return connections.get(session)?.publisher.ack(session, sequence) ?? false; },
    disconnect(session) {
      const c = connections.get(session);
      if (!c) return 'absent';
      c.live = false; c.publisher.dispose(); interest.removeObserver(c.observer); connections.delete(session);
      return 'disconnected';
    },
    /**
     * One host tick: recompute each connection's interest set; a membership change, or a change to an entity in the
     * set, marks that view dirty (with complete scans, changes outside the set never cause a frame; an incomplete
     * scan can, see the guide); then pump once (one credit per connection). An incomplete or unavailable set is still published: it
     * discloses only the members it verified.
     */
    tick() {
      const report = [];
      for (const c of connections.values()) {
        const r = interest.update(c.observer, result);
        let changed = r.enteredCount > 0 || r.leftCount > 0;
        for (let i = 0; !changed && i < r.relevantCount; i++) changed = (entities.get(r.relevant[i])?.rev ?? 0) > c.checkedAt;
        c.checkedAt = worldRevision;
        if (changed) { c.viewRevision++; c.publisher.markDirty(); }
        const pumped = c.publisher.pump();
        report.push({ session: c.session, status: r.status, relevant: r.relevantCount, entered: [...r.entered.subarray(0, r.enteredCount)],
          left: [...r.left.subarray(0, r.leftCount)], dropped: r.dropped, pump: pumped.status });
      }
      return report;
    },
    read() { return { worldRevision, entities: entities.size, connections: connections.size, interest: interest.stats }; },
    close() { for (const s of [...connections.keys()]) host.disconnect(s); interest.dispose(); grid.dispose(); },
  };
  return host;
}

export const demoConfig = Object.freeze({
  grid: { cellSize: 16, minX: 0, minY: 0, maxX: 512, maxY: 512, maxEntries: 1024, maxCells: 1024, maxCellsPerQuery: 64 },
  interest: { enterRadius: 40, exitRadius: 48, holdUpdates: 1, maxObservers: 8, maxRelevant: 16, maxCandidates: 512, maxPrioritized: 64 },
  view: { maxBytes: 65536, maxNodes: 4096, maxDepth: 8, maxEntities: 64, maxIdentityLength: 256 },
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = createInterestHost(demoConfig), frames = [];
  host.connect('alpha', 100, 100, json => { frames.push(JSON.parse(json)); return true; });
  host.spawn(1, 110, 100); host.spawn(2, 300, 300);
  const log = [];
  for (let t = 0; t < 6; t++) {
    host.move(2, 300 - t * 40, 300 - t * 40);
    log.push(...host.tick());
    const last = frames.at(-1);
    if (last) host.ack('alpha', last.sequence);
  }
  process.stdout.write(`${JSON.stringify({ ticks: log, frames: frames.map(f => ({ sequence: f.sequence, ids: f.entities.map(e => e.id) })) }, null, 2)}\n`);
  host.close();
}
