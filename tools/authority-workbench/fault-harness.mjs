// NW-09: seeded fault-schedule harness for the composed authority workbench path.
//
// Process-scope, loopback-only evidence. It drives the real reference host
// (intake + rate admission + durable authority + SQLite adapter) over real
// loopback WebSockets with two scripted clients (prediction + retry schedule +
// close policy), injects a seeded schedule of combined faults, and checks
// invariants after every step against an independent read-only SQLite readback.
// It does not establish WAN behaviour, power-loss durability, physical devices
// or multiplayer scale.
//
// Determinism: all time is virtual (host and client clocks are injected), all
// randomness is derived from the seed, and every step waits for loopback
// quiescence (each forwarded frame processed by the host, each host frame
// delivered to the client, each close observed on both ends) before the next
// phase. Socket tokens and ports differ between runs but never enter the trace.
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir, setPriority } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { createPrediction } from '../../src/kits/network/prediction.ts';
import { createRetrySchedule } from '../../src/kits/network/retry-schedule.ts';
import { createClosePolicy } from '../../src/kits/network/close-policy.ts';
import { initializeAuthorityWorkbench, startAuthorityWorkbench, authorityLimits } from './server.mjs';
import { generateSchedule, deriveRandom, describeStep, shrinkSchedule, CLIENTS } from './fault-schedule.mjs';

/** Harness bounds. The host's own limits live in server.mjs and are not changed here. */
export const HARNESS_LIMITS = Object.freeze({
  inbox: 16, // client frames buffered while a slow consumer is not reading; overflow closes locally
  link: 64, // frames held by one link direction (delay/reorder); exceeding it is a harness failure
  resendMs: 300, // client exact-retry interval for an unconfirmed command
  baselineTimeoutMs: 2000, // client closes a connection that never produced a baseline
  storageArmSteps: 8,
  userRetrySteps: 20, // a client that gave up is reconnected by its user after this many steps // an armed storage fault that never fires is disarmed after this many steps
  healSteps: 500,
  healDt: 100,
  quiesceMs: 4000, // real-time bound for one quiescence wait; exceeding it is a "stuck" failure
});
const HOST = Object.freeze({ // mirrors server.mjs reference limits for bound checks
  maxConnections: 8, maxQueuedMessages: 8, maxQueuedBytes: 8192, maxPendingAuth: 8, controllers: CLIENTS.length,
});
const PREDICTION_LIMITS = Object.freeze({
  state: authorityLimits.state,
  input: authorityLimits.input,
  maxPending: 8,
  maxPendingBytes: 1024,
  maxReplaySteps: 8,
});
const RETRY_LIMITS = Object.freeze({ baseMs: 100, capMs: 2000, maxAttempts: 8, budget: { capacity: 12, refillEveryMs: 1000 } });
const integer = Number.isSafeInteger;
/** Default CI-sized run: seeds 1..DEFAULT_SEEDS, DEFAULT_STEPS steps each (a few seconds on loopback). */
export const DEFAULT_SEEDS = 12;
export const DEFAULT_STEPS = 300;
const exactKeys = (x, keys) => x !== null && typeof x === 'object' && !Array.isArray(x)
  && Object.keys(x).length === keys.length && keys.every((k) => Object.hasOwn(x, k));
const validInput = (x) => exactKeys(x, ['add']) && integer(x.add) && Math.abs(x.add) <= 10;

export class FaultFailure extends Error {
  constructor(invariant, detail) {
    super(`${invariant}: ${detail}`);
    this.invariant = invariant;
    this.detail = detail;
  }
}
const fail = (invariant, detail) => { throw new FaultFailure(invariant, detail); };
const check = (ok, invariant, detail) => { if (!ok) fail(invariant, typeof detail === 'function' ? detail() : detail); };

/** Open handle counts that the run must return to: sockets, servers and timers. */
function resources() {
  const counts = { TCPSocketWrap: 0, TCPServerWrap: 0, Timeout: 0 };
  for (const kind of process.getActiveResourcesInfo()) if (kind in counts) counts[kind]++;
  return counts;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Run one schedule. Returns `{ok, seed, steps, failure, fingerprint, trace, stats}`;
 * `failure` is `{step, phase, invariant, detail}` where `step` is the schedule index
 * (or null for the heal/cleanup phases).
 */
export async function runFaultSchedule({ seed, schedule, allowSabotage = false, limits = HARNESS_LIMITS }) {
  if (!integer(seed) || seed < 0 || !Array.isArray(schedule)) throw Error('fault harness: options');
  const before = resources();
  const heap = process.memoryUsage().heapUsed;
  const directory = await mkdtemp(join(tmpdir(), 'foundation-nw09-'));
  const run = createRun({ seed, schedule, allowSabotage, directory, limits });
  let failure = null;
  try {
    await run.execute();
  } catch (error) {
    failure = run.describeFailure(error);
  }
  try {
    await run.cleanup();
  } catch (error) {
    failure ??= { ...run.describeFailure(error), phase: 'cleanup', step: null };
  }
  await rm(directory, { recursive: true, force: true });
  // Leak check: every socket, server and timer started by the run is released.
  const end = Date.now() + 2000;
  let after = resources();
  while (Object.keys(before).some((k) => after[k] > before[k]) && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    after = resources();
  }
  const leaked = Object.keys(before).filter((k) => after[k] > before[k]);
  if (leaked.length && !failure)
    failure = { step: null, phase: 'cleanup', invariant: 'leaked-handles',
      detail: leaked.map((k) => `${k} ${before[k]} -> ${after[k]}`).join(', ') };
  const trace = run.trace;
  const fingerprint = createHash('sha256').update(trace.join('\n')).digest('hex').slice(0, 16);
  return Object.freeze({
    ok: failure === null, seed, steps: schedule.length, failure, fingerprint, trace,
    stats: { ...run.stats, heapDeltaBytes: process.memoryUsage().heapUsed - heap },
  });
}

function createRun({ seed, schedule, allowSabotage, directory, limits }) {
  const dbPath = join(directory, 'world.db');
  const trace = [];
  const stats = {
    commits: 0, healSteps: 0, connects: 0, restarts: 0, crashes: 0, storageFaults: 0, recoveries: 0,
    storageBeforeCommit: 0, storageAfterCommit: 0, hostResults: {}, preAuthDropped: 0,
    overflowCloses: 0, baselineTimeouts: 0, hostCloses: 0, replaced: 0, revoked: 0, dropped: 0,
    duplicated: 0, delayed: 0, results: {}, offline: 0, backpressure: 0, gaveUp: 0,
  };
  let virtual = 0, hostSkew = 0, step = 0, phase = 'setup';
  let host = null, hostGen = 0, url = null, downUntil = -1, hostStorageFault = null;
  let reader = null, readStmt = null, hold = null, storageArm = null;
  const ops = new Set(); // operator/recovery promises in flight
  const opResults = [];
  const revokedNow = new Map(); // principal -> stream through at revocation (current host generation)
  const labels = new Map(); // connection label -> loopback accounting
  const latestLabel = new Map(); // principal -> label of the latest authenticated controller (this host)
  const hostSent = []; // frames the host sent during this step
  const violations = []; // detected inside host callbacks; raised in the invariant phase
  // Oracle built from independent readback: every receipt ever observed, by key and by revision.
  const ledger = { receipts: new Map(), byRevision: new Map(), throughs: new Map(), revisionsByStream: new Map(),
    revision: 0, lineage: null, stateAt: [0], envelope: null };
  const closePolicy = createClosePolicy();
  let stepStartThroughs = new Map();

  const hooks = {
    beforeCommit() { storageHook('before'); },
    afterCommit() { storageHook('after'); },
  };
  function storageHook(when) {
    if (!storageArm || storageArm.fired || storageArm.when !== when) return;
    storageArm.fired = true;
    storageArm.firedStep = step;
    storageArm.gen = hostGen;
    storageArm.revisionAtHook = readStmt.get().revision;
    hostStorageFault = when;
    stats.storageFaults++;
    stats[when === 'before' ? 'storageBeforeCommit' : 'storageAfterCommit']++;
    throw Error(`injected ${when}-commit storage failure`);
  }

  function onHost(gen, event) {
    if (gen !== hostGen) return violations.push(`event from retired host generation ${gen}: ${event.type}`);
    const rec = labels.get(event.label);
    if (!rec) return violations.push(`host event for unknown label ${event.label}`);
    switch (event.type) {
      case 'open': rec.hostOpened = true; break;
      case 'refused': rec.refused = true; break;
      case 'frame': rec.hostFrames++; break;
      case 'close': rec.hostClosed = true; stats.hostCloses++; break;
      case 'sent': {
        rec.hostSent++;
        const frame = JSON.parse(event.frame);
        if (frame.type === 'authenticated') {
          if (frame.principal !== rec.client)
            violations.push(`${event.label} authenticated as ${frame.principal}`);
          latestLabel.set(frame.principal, event.label);
        }
        if (revokedNow.has(rec.client))
          violations.push(`disclosure after revoke: ${frame.type} to ${event.label}`);
        if (latestLabel.get(rec.client) !== event.label)
          violations.push(`disclosure to replaced controller ${event.label}: ${frame.type}`);
        hostSent.push({ label: event.label, client: rec.client, frame });
        break;
      }
      default: violations.push(`unknown host event ${event.type}`);
    }
  }

  // ---- host lifecycle ----
  async function startHost() {
    const gen = ++hostGen;
    revokedNow.clear();
    latestLabel.clear();
    hostStorageFault = null;
    host = await startAuthorityWorkbench({
      directory, autoDriver: false, clock: () => virtual + hostSkew, storageHooks: hooks,
      observe: (event) => onHost(gen, event),
    });
    url = host.url;
  }
  async function closeHost() {
    if (!host) return;
    const h = host;
    host = null;
    await h.close();
    if (hold) hold = null;
  }
  async function restartHost(down) {
    await closeHost();
    stats.restarts++;
    downUntil = step + down;
    if (down === 0) await startHost();
  }
  async function recover() {
    await track(host.recoverAuthority());
    if (host.read().status === 'ready') hostStorageFault = null;
  }
  function track(promise) {
    const p = promise.then((value) => { opResults.push(value); }, (error) => {
      violations.push(`host operation rejected: ${error.message}`);
    }).finally(() => ops.delete(p));
    ops.add(p);
    return p;
  }

  // ---- clients ----
  const clients = CLIENTS.map((id) => ({
    id, skew: 0, lastClock: 0, conn: null, orphans: [], prediction: null, intents: [], issued: new Map(),
    confirmedThrough: 0, maxIssued: 0, state: 'idle', wait: null, slowUntil: -1, manualEpisodes: 0,
    linkFault: { up: null, down: null }, link: deriveRandom(seed, `link-${id}`), attempt: 0,
    retry: createRetrySchedule({ limits: RETRY_LIMITS, random: deriveRandom(seed, `retry-${id}`).next }),
    results: [], baselines: [],
  }));
  const byId = new Map(clients.map((c) => [c.id, c]));
  const clientNow = (c) => (c.lastClock = Math.max(c.lastClock, virtual + c.skew));

  function connect(c) {
    const label = `${c.id}-${++c.attempt}`;
    const rec = { client: c.id, forwarded: 0, hostFrames: 0, hostSent: 0, arrived: 0, hostOpened: false,
      hostClosed: false, refused: false };
    labels.set(label, rec);
    const socket = new WebSocket(`${url}?label=${label}`);
    const conn = { socket, label, rec, session: null, epoch: null, up: [], down: [], arrived: [], inbox: [],
      closed: false, closeInfo: null, authSent: false, order: 0, startedAt: clientNow(c), local: null };
    socket.on('message', (raw) => { rec.arrived++; conn.arrived.push(raw.toString()); });
    socket.on('close', (code, reason) => { conn.closed = true; conn.closeInfo = { code, reason: reason.toString() }; });
    socket.on('error', () => {});
    c.conn = conn;
    c.state = 'connecting';
    stats.connects++;
  }
  function dropConnection(c, why) {
    const conn = c.conn;
    if (!conn) return;
    conn.local = why;
    conn.inbox.length = 0;
    conn.socket.terminate();
  }
  function lose(c) {
    const conn = c.conn;
    c.conn = null;
    c.prediction?.dispose();
    c.prediction = null;
    if (c.state === 'retired' || c.state === 'gave-up') return;
    const code = conn.closeInfo?.code;
    const remote = conn.local || code === 1005 || code === 1006 || code === undefined ? null
      : { code, reason: conn.closeInfo.reason || null };
    if (closePolicy.classify(remote) === 'terminal') { c.state = 'retired'; return; }
    pace(c, c.retry.next(clientNow(c)));
  }
  function pace(c, next) {
    if (next.status === 'wait') { c.state = 'waiting'; c.wait = null; }
    else if (next.status === 'budget-empty') { c.state = 'waiting'; c.wait = next.refillAtMs; }
    else if (next.status === 'exhausted') {
      c.state = phase === 'heal' && c.manualEpisodes > 0 ? 'retired' : 'gave-up';
      c.gaveUpAt = step;
      stats.gaveUp++;
    } else fail('client-retry', `${c.id} retry schedule returned ${next.status}`);
  }

  // Link layer: per-connection, per-direction seeded faults (the "proxy").
  function enqueue(c, conn, dir, raw) {
    const queue = dir === 'up' ? conn.up : conn.down;
    const fault = c.linkFault[dir];
    const due = [];
    if (fault && fault.count > 0) {
      fault.count--;
      if (fault.mode === 'delay') { due.push(step + c.link.int(1, 4)); stats.delayed++; }
      else if (fault.mode === 'reorder') { due.push(step + c.link.int(0, 3)); stats.delayed++; }
      else if (fault.mode === 'duplicate') { due.push(step, step); stats.duplicated++; }
      else stats.dropped++;
      if (fault.count === 0) c.linkFault[dir] = null;
    } else due.push(step);
    for (const d of due) queue.push({ raw, due: d, order: conn.order++ });
    check(queue.length <= limits.link, 'harness-bound', `${conn.label} ${dir} link holds ${queue.length}`);
  }
  function release(queue, all = false) {
    const ready = queue.filter((f) => all || f.due <= step).sort((x, y) => x.due - y.due || x.order - y.order);
    const kept = queue.filter((f) => !(all || f.due <= step));
    queue.length = 0;
    queue.push(...kept);
    return ready.map((f) => f.raw);
  }
  function send(c, frame) {
    if (c.conn) enqueue(c, c.conn, 'up', JSON.stringify(frame));
  }
  function sendIntent(c, intent) {
    const conn = c.conn;
    send(c, { v: 1, type: 'command', session: conn.session, epoch: conn.epoch, sequence: intent.sequence,
      inputJson: intent.json });
    intent.lastSent = clientNow(c);
    intent.session = conn.session;
  }
  function input(c, add) {
    const p = c.prediction;
    if (!p || p.read().status !== 'ready') { stats.offline++; return; }
    if (p.read().pending.length >= PREDICTION_LIMITS.maxPending) { stats.backpressure++; return; }
    const out = p.push(JSON.stringify({ add }));
    check(out.status === 'predicted', 'prediction-push', () => `${c.id} push ${out.status} ${p.read().reason}`);
    const intent = { sequence: out.input.sequence, json: out.input.json, lastSent: -Infinity, session: null, done: false };
    check(intent.sequence === c.maxIssued + 1, 'client-sequence',
      () => `${c.id} issued ${intent.sequence} after ${c.maxIssued}`);
    c.intents.push(intent);
    c.issued.set(intent.sequence, intent.json);
    c.maxIssued = intent.sequence;
    sendIntent(c, intent);
  }
  function adoptBaseline(c, frame) {
    const now = clientNow(c);
    c.baselines.push(frame);
    check(frame.processedThrough <= c.maxIssued, 'consumed-unissued',
      () => `${c.id} baseline consumed ${frame.processedThrough} but issued ${c.maxIssued}`);
    if (!c.prediction) {
      // A fresh connection's first adopted baseline must not forget a prefix confirmed
      // on an earlier connection. Within one connection, older frames are obsolete.
      check(frame.processedThrough >= c.confirmedThrough, 'client-rollback',
        () => `${c.id} fresh baseline processedThrough ${frame.processedThrough} < confirmed ${c.confirmedThrough}`);
      c.prediction = createPrediction({
        epoch: c.conn.epoch, baseline: frame, limits: PREDICTION_LIMITS, validateState: integer,
        validateInput: validInput, reduce: (state, x) => JSON.stringify(state + x.add),
      });
      c.intents = c.intents.filter((i) => i.sequence > frame.processedThrough);
      for (const intent of c.intents) {
        const out = c.prediction.push(intent.json);
        check(out.status === 'predicted' && out.input.sequence === intent.sequence, 'resequence',
          () => `${c.id} re-predicted ${intent.sequence} as ${out.input?.sequence ?? out.status}`);
        Object.assign(intent, { lastSent: -Infinity, session: null, done: false });
      }
      c.retry.succeeded(now);
      c.state = 'online';
    } else {
      const out = c.prediction.reconcile(frame);
      check(['reconciled', 'duplicate', 'obsolete'].includes(out.status), 'prediction-reconcile',
        () => `${c.id} reconcile ${out.status} ${c.prediction.read().reason}`);
    }
    const confirmed = c.prediction.read().confirmed.processedThrough;
    c.confirmedThrough = Math.max(c.confirmedThrough, confirmed);
    c.intents = c.intents.filter((i) => i.sequence > c.confirmedThrough);
  }
  function receive(c, raw) {
    const conn = c.conn;
    let frame;
    try { frame = JSON.parse(raw); } catch { fail('host-frame', `${conn.label} sent invalid JSON`); }
    if (!conn.session) {
      if (frame?.type !== 'authenticated') { stats.preAuthDropped++; return; }
      check(exactKeys(frame, ['v', 'type', 'principal', 'session', 'epoch']) && frame.principal === c.id,
        'host-frame', () => `${conn.label} authentication frame for ${frame.principal}`);
      conn.session = frame.session;
      conn.epoch = frame.epoch;
      return;
    }
    if (frame.type === 'authenticated') {
      check(frame.session === conn.session && frame.epoch === conn.epoch, 'host-frame',
        `${conn.label} second authentication on one connection`);
      return;
    }
    check(frame.v === 1 && frame.session === conn.session && frame.epoch === conn.epoch, 'cross-session-frame',
      () => `${conn.label} ${frame.type} for another session or epoch`);
    if (frame.type === 'result') {
      check(integer(frame.sequence) && frame.sequence >= 1 && typeof frame.status === 'string', 'host-frame',
        `${conn.label} malformed result`);
      check(frame.status !== 'conflict', 'conflict',
        () => `${c.id} seq ${frame.sequence} reported conflict, but clients only resend exact payloads`);
      c.results.push(frame);
      stats.results[frame.status] = (stats.results[frame.status] ?? 0) + 1;
      const intent = c.intents.find((i) => i.sequence === frame.sequence);
      if (intent && (frame.status === 'committed' || frame.status === 'duplicate')) intent.done = true;
      return;
    }
    check(frame.type === 'baseline' && exactKeys(frame, ['v', 'type', 'session', 'epoch', 'revision',
      'processedThrough', 'stateJson']) && integer(frame.revision) && integer(frame.processedThrough)
      && typeof frame.stateJson === 'string', 'host-frame', () => `${conn.label} malformed ${frame.type}`);
    adoptBaseline(c, frame);
  }

  // ---- loopback quiescence ----
  function settled(conn) {
    const rs = conn.socket.readyState, rec = conn.rec;
    if (rs === WebSocket.OPEN) {
      if (rec.hostClosed || rec.refused || !rec.hostOpened) return false;
      return rec.forwarded === rec.hostFrames && rec.hostSent === rec.arrived;
    }
    if (rs !== WebSocket.CLOSED || !conn.closed) return false;
    return !rec.hostOpened || rec.hostClosed;
  }
  function unsettled() {
    const out = [];
    for (const c of clients)
      for (const conn of [c.conn, ...c.orphans]) if (conn && !settled(conn)) {
        const r = conn.rec;
        out.push(`${conn.label} ready=${conn.socket.readyState} open=${r.hostOpened} hostClosed=${r.hostClosed} `
          + `up=${r.forwarded}/${r.hostFrames} down=${r.hostSent}/${r.arrived}`);
      }
    if (host) {
      const st = host.read();
      if (st.status === 'pending' && !st.commitResponseHeld) out.push('authority pending');
    }
    if (ops.size && !(host?.read().commitResponseHeld)) out.push(`${ops.size} host operation(s)`);
    return out;
  }
  async function quiesce() {
    const end = Date.now() + limits.quiesceMs;
    for (;;) {
      await tick();
      if (unsettled().length === 0) {
        await tick();
        if (unsettled().length === 0) return;
      }
      if (Date.now() > end) fail('stuck', `loopback did not quiesce: ${unsettled().join('; ')}`);
    }
  }

  // ---- independent readback and invariants ----
  function readDb() {
    const row = readStmt.get();
    check(row && typeof row.envelope === 'string', 'readback', 'checkpoint row missing');
    const env = JSON.parse(row.envelope);
    check(env.revision === row.revision, 'readback', 'row revision differs from envelope');
    return env;
  }
  function observeDb() {
    const env = readDb();
    ledger.lineage ??= env.lineage;
    check(env.lineage === ledger.lineage, 'lineage', 'checkpoint lineage changed');
    check(env.revision >= ledger.revision, 'revision-rollback', () => `revision ${env.revision} < ${ledger.revision}`);
    check(env.streams.length <= authorityLimits.maxStreams, 'bounded-streams', `${env.streams.length} streams`);
    let sum = 0;
    const seen = new Set();
    for (const s of env.streams) {
      check(!seen.has(s.id), 'stream-duplicate', `stream ${s.id} twice`);
      seen.add(s.id);
      sum += s.through;
      check(s.through >= (ledger.throughs.get(s.id) ?? 0), 'stream-rollback',
        () => `${s.id} through ${s.through} < ${ledger.throughs.get(s.id)}`);
      check(s.receipts.length <= authorityLimits.maxReceiptsPerStream, 'bounded-receipts',
        `${s.id} retains ${s.receipts.length}`);
      s.receipts.forEach((r, i) => {
        check(r.sequence === s.through - s.receipts.length + 1 + i, 'sequence-gap',
          () => `${s.id} receipts ${s.receipts.map((x) => x.sequence)} through ${s.through}`);
        check(r.revision >= 1 && r.revision <= env.revision && (i === 0 || r.revision > s.receipts[i - 1].revision),
          'receipt-order', () => `${s.id} receipt revisions ${s.receipts.map((x) => x.revision)}`);
        const key = `${s.id}:${r.sequence}`, json = JSON.stringify(r);
        const known = ledger.receipts.get(key);
        if (known !== undefined) check(known === json, 'receipt-immutable', () => `${key} was ${known}, now ${json}`);
        else {
          const other = ledger.byRevision.get(r.revision);
          check(!other, 'sequence-duplicate', () => `revision ${r.revision} held by ${other.stream}:${other.sequence} and ${key}`);
          ledger.receipts.set(key, json);
          ledger.byRevision.set(r.revision, { stream: s.id, sequence: r.sequence, input: r.input, result: r.result });
          const revisions = ledger.revisionsByStream.get(s.id) ?? [];
          check(revisions.length === r.sequence - 1, 'unobserved-commit', `${key} recorded after ${revisions.length}`);
          revisions.push(r.revision);
          ledger.revisionsByStream.set(s.id, revisions);
          const issued = byId.get(s.id)?.issued.get(r.sequence);
          if (byId.has(s.id))
            check(issued === JSON.stringify(r.input), 'committed-unissued',
              () => `${key} committed ${JSON.stringify(r.input)} but client issued ${issued}`);
          if (r.revision > ledger.revision) stats.commits++;
        }
      });
      ledger.throughs.set(s.id, s.through);
    }
    check(sum === env.revision, 'prefix-sum', () => `sum of stream prefixes ${sum} != revision ${env.revision}`);
    for (let rev = ledger.revision + 1; rev <= env.revision; rev++) {
      const r = ledger.byRevision.get(rev);
      check(r, 'unobserved-commit', `revision ${rev} evicted before the harness observed it`);
      ledger.stateAt[rev] = ledger.stateAt[rev - 1] + r.input.add;
    }
    ledger.revision = env.revision;
    check(env.state === ledger.stateAt[env.revision], 'state-history',
      () => `state ${env.state} != sum of committed inputs ${ledger.stateAt[env.revision]}`);
    ledger.envelope = env;
    return env;
  }
  /** Consumed prefix of `stream` at world `revision`: commits of that stream at or below it. */
  const throughAt = (stream, revision) => {
    const revisions = ledger.revisionsByStream.get(stream) ?? [];
    let lo = 0, hi = revisions.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (revisions[mid] <= revision) lo = mid + 1; else hi = mid; }
    return lo;
  };
  function checkResult(client, frame, where) {
    const key = `${client}:${frame.sequence}`;
    if (frame.status === 'committed' || frame.status === 'duplicate') {
      const r = ledger.receipts.get(key);
      check(r, 'result-without-receipt', `${where} ${frame.status} ${key} has no durable receipt`);
      const receipt = JSON.parse(r);
      check(frame.revision === receipt.revision && frame.resultJson === JSON.stringify(receipt.result),
        'receipt-mismatch', () => `${where} ${key} reported r${frame.revision} ${frame.resultJson}, durable ${r}`);
    } else if (frame.status === 'gap' && where === 'host')
      // Stream prefixes only grow, so a gap must exceed the prefix known before this step.
      check(frame.sequence > (stepStartThroughs.get(client) ?? 0) + 1, 'gap-for-consumed',
        () => `${key} reported gap but ${client} had consumed ${stepStartThroughs.get(client) ?? 0} before the step`);
    else if (frame.status === 'result-unavailable')
      check((ledger.throughs.get(client) ?? 0) >= frame.sequence, 'result-unavailable-unconsumed',
        `${where} ${key} reported consumed but stream is at ${ledger.throughs.get(client)}`);
  }
  function invariants() {
    if (violations.length) fail('host-observation', violations.join('; '));
    const env = observeDb();
    for (const { client, frame } of hostSent.splice(0)) if (frame.type === 'result') {
      stats.hostResults[frame.status] = (stats.hostResults[frame.status] ?? 0) + 1;
      checkResult(client, frame, 'host');
    }
    for (const out of opResults.splice(0))
      if (out.status === 'committed' || out.status === 'duplicate')
        checkResult('operator', { ...out, resultJson: JSON.stringify(out.result) }, 'operator');
    for (const c of clients) {
      for (const frame of c.results.splice(0)) checkResult(c.id, frame, c.id);
      for (const b of c.baselines.splice(0)) {
        check(b.revision <= ledger.revision && JSON.parse(b.stateJson) === ledger.stateAt[b.revision]
          && b.processedThrough === throughAt(c.id, b.revision), 'baseline-coherence',
        () => `${c.id} baseline r${b.revision} p${b.processedThrough} s${b.stateJson} vs durable `
          + `s${ledger.stateAt[b.revision]} p${throughAt(c.id, b.revision)}`);
      }
      const p = c.prediction?.read();
      if (p) {
        check(p.pending.length <= PREDICTION_LIMITS.maxPending && c.intents.length <= PREDICTION_LIMITS.maxPending,
          'bounded-pending', `${c.id} pending ${p.pending.length}`);
        check(p.status === 'ready', 'prediction-state', () => `${c.id} prediction ${p.status} ${p.reason}`);
        // Independent replay: predicted = confirmed authority state + every unconfirmed input, in order.
        const expected = JSON.parse(p.confirmed.state.json) + p.pending.reduce((sum, x) => sum + x.value.add, 0);
        check(JSON.parse(p.predicted.json) === expected && p.pending.every((x, i) =>
          x.sequence === p.confirmed.processedThrough + 1 + i && c.issued.get(x.sequence) === x.json), 'prediction-replay',
        () => `${c.id} predicted ${p.predicted.json}, expected ${expected} from confirmed ${p.confirmed.state.json} `
          + `and pending ${p.pending.map((x) => x.sequence)}`);
      }
      for (const conn of [c.conn, ...c.orphans].filter(Boolean))
        check(conn.inbox.length <= limits.inbox && conn.up.length <= limits.link && conn.down.length <= limits.link,
          'harness-bound', `${conn.label} queues`);
      if (revokedNow.has(c.id))
        check((ledger.throughs.get(c.id) ?? 0) === revokedNow.get(c.id), 'commit-after-revoke',
          () => `${c.id} advanced to ${ledger.throughs.get(c.id)} after revocation at ${revokedNow.get(c.id)}`);
    }
    if (host) {
      const st = host.read();
      check(st.connections === st.intake.connections && st.connections <= HOST.maxConnections
        && st.intake.queuedMessages <= HOST.maxQueuedMessages && st.intake.queuedBytes <= HOST.maxQueuedBytes
        && st.intake.pendingAuth <= HOST.maxPendingAuth && st.peers.length <= HOST.controllers,
      'host-bounds', () => `connections ${st.connections}/${st.intake.connections} queued ${st.intake.queuedMessages} `
        + `bytes ${st.intake.queuedBytes} controllers ${st.peers.length}`);
      if (st.status === 'ready')
        check(JSON.stringify(st.checkpoint) === JSON.stringify(env), 'authority-storage-divergence',
          () => `authority r${st.checkpoint.revision} vs storage r${env.revision}`);
      else
        check((st.status === 'pending' && st.commitResponseHeld)
          || (hostStorageFault === 'before' && st.status === 'unavailable')
          || (hostStorageFault === 'after' && st.status === 'unknown'), 'authority-unavailable',
        () => `authority ${st.status} without an injected cause (storage fault: ${hostStorageFault})`);
      if (storageArm?.fired && storageArm.firedStep === step && storageArm.gen === hostGen)
        check(env.revision === storageArm.revisionAtHook, 'storage-outcome',
          () => `${storageArm.when}-commit failure: storage r${env.revision}, at hook r${storageArm.revisionAtHook}`);
    }
  }

  // ---- step phases ----
  async function forwardUp() {
    for (const c of clients) {
      const conn = c.conn;
      if (!conn) continue;
      const frames = release(conn.up);
      if (conn.socket.readyState !== WebSocket.OPEN) continue; // lost with the connection
      for (const raw of frames) { conn.socket.send(raw); conn.rec.forwarded++; }
      if (frames.length) await quiesce();
    }
  }
  function deliverDown(all = false) {
    for (const c of clients) {
      for (const orphan of c.orphans) orphan.arrived.length = 0; // abandoned connection: never read
      const conn = c.conn;
      if (!conn) continue;
      if (conn.local) { conn.arrived.length = 0; continue; } // locally closed: frames are never read
      for (const raw of conn.arrived.splice(0)) enqueue(c, conn, 'down', raw);
      conn.inbox.push(...release(conn.down, all));
      if (conn.inbox.length > limits.inbox) { stats.overflowCloses++; dropConnection(c, 'inbound-overflow'); }
    }
  }
  function clientPhase() {
    for (const c of clients) {
      c.orphans = c.orphans.filter((o) => !(o.closed && settled(o)));
      if (c.conn?.closed) lose(c);
      const conn = c.conn, now = clientNow(c);
      if (conn && !conn.local && (phase === 'heal' || step >= c.slowUntil))
        for (const raw of conn.inbox.splice(0)) receive(c, raw);
      if (conn && !conn.local && conn.socket.readyState === WebSocket.OPEN && !conn.authSent) {
        conn.authSent = true;
        send(c, { v: 1, type: 'auth', token: credentials()[c.id] });
      }
      if (conn && !conn.local && !c.prediction && now - conn.startedAt >= limits.baselineTimeoutMs) {
        stats.baselineTimeouts++;
        dropConnection(c, 'baseline-timeout');
      }
      if (c.state === 'waiting') {
        if (c.wait !== null) { if (now >= c.wait) pace(c, c.retry.next(now)); }
        else if (c.retry.due(now)) connect(c);
      } else if (c.state === 'idle' && !c.conn) connect(c);
      else if (c.state === 'gave-up' && phase === 'schedule' && step - c.gaveUpAt >= limits.userRetrySteps) {
        c.retry.cancel(); // the user presses reconnect after the automatic episode gave up
        connect(c);
      }
      if (c.prediction && c.conn?.session && !c.conn.local) {
        const next = c.intents.find((i) => !i.done && (i.session !== c.conn.session || now - i.lastSent >= limits.resendMs));
        if (next) sendIntent(c, next);
      }
    }
  }
  let knownCredentials = null;
  const credentials = () => (knownCredentials ??= host?.credentials);
  async function hostPhase() {
    if (!host && downUntil >= 0 && step >= downUntil) { downUntil = -1; await startHost(); }
    if (!host) return;
    host.pump();
    await quiesce();
    if (hold && host.read().commitResponseHeld && !hold.acted) {
      hold.acted = true;
      if (hold.then === 'crash') { stats.crashes++; await restartHost(1); }
      else if (hold.then === 'drop-client') byId.get(hold.c).conn?.socket.terminate();
      await quiesce();
    }
    if (hold && host && (step >= hold.until)) {
      host.releaseCommitResponse();
      hold = null;
      await quiesce();
    }
    if (storageArm && host) {
      if (storageArm.fired && step >= storageArm.firedStep + storageArm.after) {
        stats.recoveries++;
        if (storageArm.recovery === 'restart') await restartHost(0);
        else await recover();
        storageArm = null;
        await quiesce();
      } else if (!storageArm.fired && step >= storageArm.armedStep + limits.storageArmSteps) storageArm = null;
    }
  }
  async function apply(action) {
    const c = byId.get(action.c);
    switch (action.t) {
      case 'input': input(c, action.add); break;
      case 'operator': if (host) track(host.operatorAdd({ add: action.add })); break;
      case 'idle': break;
      case 'net': c.linkFault[action.dir] = { mode: action.mode, count: action.count }; break;
      case 'disconnect': if (c.conn) dropConnection(c, 'disconnect'); break;
      case 'replace':
        if (c.conn && c.state === 'online') {
          stats.replaced++;
          c.orphans.push(c.conn);
          c.conn = null;
          c.prediction?.dispose();
          c.prediction = null;
          connect(c);
        }
        break;
      case 'hold-commit':
        if (host && !hold) { host.holdCommitResponse(true); hold = { ...action, until: step + action.steps, acted: false }; }
        break;
      case 'restart': await restartHost(action.down); break;
      case 'storage': if (!storageArm) storageArm = { ...action, fired: false, armedStep: step }; break;
      case 'clock':
        if (action.target === 'host') hostSkew += action.delta;
        else byId.get(action.target).skew += action.delta;
        break;
      case 'slow': c.slowUntil = step + action.steps; break;
      case 'revoke':
        if (host && !revokedNow.has(action.c)) {
          stats.revoked++;
          revokedNow.set(action.c, observeDb().streams.find((s) => s.id === action.c)?.through ?? 0);
          host.revoke(action.c);
        }
        break;
      case 'sabotage': {
        if (!allowSabotage) fail('schedule', 'sabotage step without allowSabotage');
        const { DatabaseSync } = await import('node:sqlite');
        const db = new DatabaseSync(dbPath);
        try {
          const env = JSON.parse(db.prepare('SELECT envelope FROM checkpoint WHERE id=1').get().envelope);
          // Valid shape, wrong history: storage accepts it; only the invariant checker can notice.
          const receipt = env.streams.find((x) => x.receipts.length)?.receipts.at(-1);
          if (action.kind === 'receipt' && receipt) receipt.result.value += 1000;
          else env.state += 1000;
          db.prepare('UPDATE checkpoint SET envelope=? WHERE id=1').run(JSON.stringify(env));
        } finally { db.close(); }
        observeDb(); // check before the host's next revision-only CAS overwrites the bytes
        break;
      }
      default: fail('schedule', `unknown step ${action.t}`);
    }
  }
  function traceLine(label) {
    const st = host?.read();
    const parts = [label, host ? `host g${hostGen} ${st.status}` : 'host down', `r${ledger.revision} s${ledger.envelope?.state}`];
    for (const c of clients) {
      const p = c.prediction?.read();
      parts.push(`${c.id} ${c.state}${c.conn ? '' : '/-'} c${c.confirmedThrough}/${c.maxIssued} p${p?.pending.length ?? '-'}`);
    }
    trace.push(parts.join(' | '));
  }
  async function runStep(action) {
    stepStartThroughs = new Map(ledger.throughs);
    virtual += action.dt;
    phase = phase === 'heal' ? 'heal' : 'schedule';
    hostSent.length = 0;
    await apply(action);
    await quiesce();
    await forwardUp();
    await hostPhase();
    deliverDown(phase === 'heal');
    clientPhase();
    await quiesce();
    invariants();
  }
  function converged() {
    if (!host || host.read().status !== 'ready' || ops.size) return false;
    const env = ledger.envelope;
    return clients.every((c) => {
      if (revokedNow.has(c.id)) return c.state === 'retired' && !c.conn;
      const p = c.prediction?.read();
      return c.state === 'online' && p?.status === 'ready' && c.intents.length === 0 && p.pending.length === 0
        && p.confirmed.revision === env.revision && p.confirmed.processedThrough === (ledger.throughs.get(c.id) ?? 0)
        && c.confirmedThrough === c.maxIssued && p.predicted.json === p.confirmed.state.json
        && JSON.parse(p.confirmed.state.json) === env.state;
    });
  }
  async function heal() {
    phase = 'heal';
    if (hold && host) host.releaseCommitResponse();
    hold = null;
    if (!host) { downUntil = -1; await startHost(); }
    storageArm = null;
    if (host.read().status !== 'ready') { stats.recoveries++; await recover(); }
    await quiesce();
    for (const c of clients) {
      c.linkFault = { up: null, down: null };
      c.slowUntil = -1;
      for (const conn of [c.conn].filter(Boolean)) for (const f of [...conn.up, ...conn.down]) f.due = step;
      if (c.state === 'gave-up') { c.manualEpisodes++; c.retry.cancel(); c.state = 'idle'; }
    }
    for (let k = 0; k < limits.healSteps; k++) {
      step = schedule.length + k;
      stats.healSteps = k + 1;
      await runStep({ t: 'idle', dt: limits.healDt });
      traceLine(`heal ${k}`);
      if (converged()) return;
      for (const c of clients) // a user's explicit reconnect after the automatic episode gave up
        if (c.state === 'gave-up' && c.manualEpisodes === 0) { c.manualEpisodes++; c.retry.cancel(); c.state = 'idle'; }
    }
    const env = ledger.envelope;
    fail('no-convergence', `after ${limits.healSteps} quiet steps: host ${host?.read().status} r${env.revision}; `
      + clients.map((c) => {
        const p = c.prediction?.read();
        return `${c.id} ${c.state} confirmed ${p?.confirmed?.revision}/${p?.confirmed?.processedThrough} `
          + `issued ${c.maxIssued} intents ${c.intents.length} pending ${p?.pending.length}`;
      }).join('; '));
  }

  return {
    trace, stats,
    async execute() {
      await initializeAuthorityWorkbench({ directory });
      const { DatabaseSync } = await import('node:sqlite');
      reader = new DatabaseSync(dbPath, { readOnly: true });
      readStmt = reader.prepare('SELECT revision, envelope FROM checkpoint WHERE id = 1');
      await startHost();
      observeDb();
      for (const c of clients) connect(c);
      await quiesce();
      for (step = 0; step < schedule.length; step++) {
        await runStep(schedule[step]);
        traceLine(`${step} ${describeStep(schedule[step])}`);
      }
      await heal();
      trace.push(`converged r${ledger.revision} s${ledger.envelope.state} after ${stats.healSteps} heal steps`);
    },
    describeFailure(error) {
      const known = error instanceof FaultFailure;
      return {
        step: phase === 'schedule' ? step : null,
        healStep: phase === 'heal' ? step - schedule.length : null,
        phase,
        invariant: known ? error.invariant : 'harness-error',
        detail: known ? error.detail : String(error?.stack ?? error),
      };
    },
    async cleanup() {
      for (const c of clients) {
        c.prediction?.dispose();
        c.retry.dispose();
        for (const conn of [c.conn, ...c.orphans]) conn?.socket.terminate();
      }
      if (hold && host) host.releaseCommitResponse();
      const end = Date.now() + limits.quiesceMs;
      while (clients.some((c) => [c.conn, ...c.orphans].some((x) => x && !x.closed)) && Date.now() < end) await tick();
      await Promise.allSettled([...ops]);
      await closeHost();
      reader?.close();
    },
  };
}

/** Run seeds; on failure optionally shrink and save the minimal schedule. */
export async function runSeeds({ seeds, steps, shrink = false, out = null, log = () => {} }) {
  const results = [];
  for (const seed of seeds) {
    const schedule = generateSchedule({ seed, steps });
    const began = Date.now();
    const result = await runFaultSchedule({ seed, schedule });
    const ms = Date.now() - began;
    results.push(result);
    if (result.ok) {
      log(`seed ${seed}: ok ${steps} steps + ${result.stats.healSteps} heal, fp ${result.fingerprint}, `
        + `${result.stats.commits} commits, ${summary(result.stats)} (${(ms / 1000).toFixed(1)} s)`);
      continue;
    }
    log(formatFailure(result, steps));
    if (shrink) {
      const { schedule: minimal, runs } = await shrinkSchedule(schedule,
        async (candidate) => (await runFaultSchedule({ seed, schedule: candidate })).failure,
        { invariant: result.failure.invariant });
      const replay = await runFaultSchedule({ seed, schedule: minimal });
      log(`  shrunk to ${minimal.length} step(s) in ${runs} runs; minimal failure: `
        + `${replay.failure ? `step ${replay.failure.step ?? replay.failure.phase} [${replay.failure.invariant}]` : 'none'}`);
      for (const [i, s] of minimal.entries()) log(`    ${i}: ${describeStep(s)}`);
      if (out) {
        await mkdir(out, { recursive: true });
        const file = join(out, `seed-${seed}.json`);
        await writeFile(file, JSON.stringify({ seed, failure: replay.failure ?? result.failure, schedule: minimal }, null, 1));
        log(`  saved ${file}; replay: npm run faults:network -- --replay ${file}`);
      }
    }
  }
  return results;
}
function summary(s) {
  return ['restarts', 'crashes', 'storageFaults', 'overflowCloses', 'baselineTimeouts', 'replaced', 'revoked',
    'dropped', 'duplicated', 'delayed'].map((k) => `${k} ${s[k]}`).join(', ');
}
export function formatFailure(result, steps) {
  const f = result.failure;
  const at = f.step !== null ? `step ${f.step}` : f.healStep !== null && f.healStep !== undefined
    ? `heal step ${f.healStep}` : `${f.phase} phase`;
  return `seed ${result.seed}: FAIL at ${at} [${f.invariant}] ${f.detail}\n`
    + `  repro: npm run faults:network -- --seed ${result.seed} --steps ${steps}`
    + (f.step !== null ? ` (fails at step index ${f.step})` : '');
}

function parseArgs(argv) {
  const args = { seeds: DEFAULT_SEEDS, start: 1, steps: DEFAULT_STEPS, seed: null, shrink: false, replay: null, out: 'playtest/network-faults' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '--seeds') { args.seeds = Number(v); i++; }
    else if (a === '--start') { args.start = Number(v); i++; }
    else if (a === '--steps') { args.steps = Number(v); i++; }
    else if (a === '--seed') { args.seed = Number(v); i++; }
    else if (a === '--replay') { args.replay = v; i++; }
    else if (a === '--out') { args.out = v; i++; }
    else if (a === '--shrink') args.shrink = true;
    else if (a === '--help') args.help = true;
    else throw Error(`unknown argument ${a}`);
  }
  for (const k of ['seeds', 'start', 'steps']) if (!integer(args[k]) || args[k] < (k === 'start' ? 0 : 1)) throw Error(`--${k}`);
  if (args.seed !== null && (!integer(args.seed) || args.seed < 0)) throw Error('--seed');
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('npm run faults:network -- [--seeds N] [--start S] [--steps M] [--seed X] [--shrink] [--replay file] [--out dir]');
    process.exit(0);
  }
  try { setPriority(10); } catch { /* best effort low priority */ }
  const log = (line) => console.log(line);
  let failed = 0;
  if (args.replay) {
    const saved = JSON.parse(await readFile(args.replay, 'utf8'));
    const result = await runFaultSchedule({ seed: saved.seed, schedule: saved.schedule });
    log(result.ok ? `replay seed ${saved.seed}: ok (${saved.schedule.length} steps)` : formatFailure(result, saved.schedule.length));
    if (!result.ok) for (const line of result.trace.slice(-12)) log(`  ${line}`);
    failed = result.ok ? 0 : 1;
  } else {
    const seeds = args.seed !== null ? [args.seed] : Array.from({ length: args.seeds }, (_, i) => args.start + i);
    const began = Date.now();
    const results = await runSeeds({ seeds, steps: args.steps, shrink: args.shrink, out: args.out, log });
    failed = results.filter((r) => !r.ok).length;
    log(`faults:network: ${results.length - failed}/${results.length} seeds passed, ${args.steps} steps each, `
      + `${((Date.now() - began) / 1000).toFixed(1)} s. Process-scope loopback evidence only.`);
  }
  process.exitCode = failed ? 1 : 0;
}
