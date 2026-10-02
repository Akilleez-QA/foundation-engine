/**
 * Optional transport-neutral shared-session host (MP-01). It composes the kit's existing owners: bounded intake
 * (admission, authentication lifetime, fair queued dispatch), per-connection scoped views with one-credit flow
 * control (NW-02), a per-connection frame token bucket (NW-05) and command integrity (SEC-01, observe by default),
 * around creator `defineSessionRules`. It owns no socket, timer, clock or process: the caller (for example
 * `npm run host`) feeds connections, text frames and monotonic time, and drives `pump(now)`.
 * State is ephemeral and in memory; there is no durable authority, account or matchmaking here.
 */
import type { DocumentValue } from '../authoring/document';
import { createIntegrity, type Integrity, type IntegrityMode } from './integrity';
import { createNetworkIntake } from './intake';
import { createRateAdmission } from './rate-admission';
import type { ConnectionHandle, NetworkLimits } from './types';
import { createViewPublisher } from './view-publisher';
import type { ViewLimits, ViewPublisher } from './view-types';
import { safeWorld, type SessionIntegrityState, type SessionRules, type SessionWorld } from './session-rules';
import {
  exactKeys, positiveInteger, randomKey, sameSecret, SESSION_CLOSE_CODES, SESSION_PLAYER_KEY, SESSION_SELF_ENTITY, sessionViewLimits,
} from './session-protocol';

export interface SessionHostLimits {
  /** Connections still joining (no join accepted yet), across all addresses. Default `max(4, maxPlayers + 2)`, so one address (2) cannot fill it. */
  readonly maxPreJoin: number;
  /** Connections still joining from one remote address (per pool), when the transport reports addresses. Default 2. */
  readonly maxPreJoinPerAddress: number;
  /**
   * Extra joining connections admitted only while the normal pre-join pool (or the address's share of it) is full.
   * Their join must resume an existing player slot (a known page key) within `reserveJoinMs`, so idle sockets
   * cannot lock out reconnecting players. Default `maxPlayers`.
   */
  readonly resumeReserve: number;
  /** Open-to-join deadline for a reserve connection. Default 500 ms. */
  readonly reserveJoinMs: number;
  /** Open-to-join deadline. Default 1500 ms. */
  readonly authTimeoutMs: number;
  /** A connection that sends nothing (clients ping) for this long is closed. */
  readonly idleTimeoutMs: number;
  /** A disconnected player keeps their slot this long; reconnecting with the same page key resumes it. */
  readonly leaveAfterMs: number;
  /**
   * Incoming frames per connection (actions, pings, joins, unsolicited acks): token bucket burst and refill per
   * second. Over the limit closes. An ack that releases this connection's outstanding view credit is not charged
   * (credit already bounds it to one per view). Default 60: twice the client's default action pacing.
   */
  readonly framesPerSecond: number;
  /**
   * Queued actions per connection. A full queue closes the connection (actions are sequenced; none is dropped).
   * Clients must not keep more unconfirmed actions than this (`createSession` `maxPending`, default equal).
   */
  readonly maxQueuedActionsPerPeer: number;
  /** Actions applied per `pump`, across connections, round robin. */
  readonly maxPumpActions: number;
  /** Host tick length for integrity rules (`tick = floor(now / tickMs)`). */
  readonly tickMs: number;
}
export type SessionHostIntegrity = IntegrityMode | 'off';
export interface SessionHostPorts<C> {
  /** Transport admission of one text frame; false closes that connection. Never throw. */
  send(conn: C, text: string): boolean;
  /** Close the transport. Called once per connection the host retires (not after `disconnected`). */
  close(conn: C, code: number, reason: string): void;
}
export interface SessionHostOptions<A extends DocumentValue, C> {
  readonly rules: SessionRules<A>;
  /** Shared join code every client must present. Use a fresh random one per run (16-128 URL-safe characters). */
  readonly joinCode: string;
  /** Integrity enforcement for `rules.integrity`: `observe` (default) audits only, `enforce` acts, `off` skips. */
  readonly integrity?: SessionHostIntegrity;
  readonly limits?: Partial<SessionHostLimits>;
  readonly ports: SessionHostPorts<C>;
  /** Optional local log line for the operator console. Never sent to clients. */
  readonly log?: (event: Readonly<{ event: string; player?: string; reason?: string }>) => void;
}
export interface SessionHostSnapshot {
  readonly worldRevision: number;
  readonly world: SessionWorld;
  readonly players: readonly Readonly<{ player: string; connected: boolean }>[];
  readonly connections: number;
  readonly metrics: Readonly<Record<string, number>>;
  readonly closeReasons: Readonly<Record<string, number>>;
  readonly integrity: Readonly<{ mode: SessionHostIntegrity; stats: unknown; audit: readonly unknown[] }>;
}
export interface SessionHost<C> {
  /**
   * A transport connected. False: refused (the host already called `ports.close`). `address` (the remote address,
   * when the transport knows it) enables the per-address pre-join cap.
   */
  connect(conn: C, now: number, address?: string): boolean;
  /** One complete text frame from that connection. */
  message(conn: C, text: string, now: number): void;
  /** The transport is gone (no close is sent back). The player keeps their slot for `leaveAfterMs`. */
  disconnected(conn: C, now: number): void;
  /** Drive from one host timer: timeouts, queued actions, leaving players and views. */
  pump(now: number): void;
  read(): SessionHostSnapshot;
  /** Closes every connection with `host-closing` and releases all owners. Idempotent. */
  dispose(): void;
}

export const DEFAULT_SESSION_HOST_LIMITS = Object.freeze({
  maxPreJoinPerAddress: 2, reserveJoinMs: 500,
  authTimeoutMs: 1500, idleTimeoutMs: 15000, leaveAfterMs: 10000, framesPerSecond: 60,
  maxQueuedActionsPerPeer: 16, maxPumpActions: 64, tickMs: 50,
});
const CAPACITY = new Set(['session-full', 'connection-limit', 'auth-limit', 'pre-auth-limit', 'queue-limit', 'rate-limit']);
const AWAY = new Set(['host-closing', 'idle-timeout', 'auth-timeout']);

type Conn<C> = {
  conn: C; peer: ConnectionHandle; player: string | null; session: string | null; publisher: ViewPublisher | null;
  processed: number; lastFrame: number; preAuthFrames: number; lastActionTick: number | null; gone: boolean;
  /** Remote address, when known. */
  address: string | null;
  /** Which pre-join pool holds this connection until its join is accepted; null once joined. */
  pool: 'normal' | 'reserve' | null;
  openedAt: number;
};
type Slot = { key: string; peer: ConnectionHandle | null; awaySince: number | null };

export function createSessionHost<A extends DocumentValue, C>(options: SessionHostOptions<A, C>): SessionHost<C> {
  const { rules, joinCode, ports } = options;
  if (!rules || rules.kind !== 'session-rules') throw Error('session host: rules must come from defineSessionRules');
  if (typeof joinCode !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(joinCode)) throw Error('session host: join code must be 16-128 URL-safe characters');
  if (!ports || typeof ports.send !== 'function' || typeof ports.close !== 'function') throw Error('session host: missing port');
  const mode: SessionHostIntegrity = options.integrity ?? 'observe';
  if (!['observe', 'enforce', 'off'].includes(mode)) throw Error('session host: invalid integrity mode');
  const supplied = options.limits ?? {};
  const limits: SessionHostLimits = Object.freeze({
    ...DEFAULT_SESSION_HOST_LIMITS, maxPreJoin: Math.max(4, rules.maxPlayers + 2), resumeReserve: rules.maxPlayers, ...supplied,
  });
  for (const value of Object.values(limits)) if (!positiveInteger(value)) throw Error('session host: limits must be positive integers');
  const log = options.log;
  const say = (event: string, fields: { player?: string; reason?: string } = {}) => {
    try { log?.(Object.freeze({ event, ...fields })); } catch { /* A broken log sink never changes host behaviour. */ }
  };

  const action = rules.limits.action;
  const messageLimits = { maxBytes: action.maxBytes + 64, maxNodes: action.maxNodes + 4, maxDepth: action.maxDepth + 1 };
  const maxFrameChars = messageLimits.maxBytes + 256;
  const viewLimits: ViewLimits = sessionViewLimits(rules.limits);
  // Joined connections are bounded by player slots (one live connection per slot); joining ones by the two pools.
  const maxConnections = rules.maxPlayers + limits.maxPreJoin + limits.resumeReserve;
  const intakeLimits: NetworkLimits = {
    maxConnections, maxPendingAuth: limits.maxPreJoin + limits.resumeReserve, maxPreAuthMessages: 2,
    authTimeoutMs: limits.authTimeoutMs, maxQueuedMessagesPerPeer: limits.maxQueuedActionsPerPeer,
    maxQueuedBytesPerPeer: limits.maxQueuedActionsPerPeer * messageLimits.maxBytes,
    maxQueuedMessages: limits.maxQueuedActionsPerPeer * maxConnections,
    maxQueuedBytes: limits.maxQueuedActionsPerPeer * maxConnections * messageLimits.maxBytes,
    maxPumpOperations: limits.maxPumpActions, message: messageLimits,
    principal: { maxBytes: 128, maxNodes: 4, maxDepth: 2 },
  };

  const initial = safeWorld(rules, rules.initial);
  if (!initial) throw Error('session host: rules.initial() returned an invalid world');
  let current: SessionWorld = initial.world, currentJson = initial.json, worldRevision = 0, disposed = false, lastNow = 0;
  const conns = new Map<ConnectionHandle, Conn<C>>(), byTransport = new Map<C, ConnectionHandle>();
  const slots = new Map<string, Slot>(), keys = new Map<string, string>(), overrides = new Map<ConnectionHandle, string>();
  const metrics = { reserveConnections: 0, connections: 0, joined: 0, resumed: 0, left: 0, applied: 0, rejected: 0, ruleErrors: 0, views: 0, closed: 0 };
  const closeReasons: Record<string, number> = {};

  const frames = createRateAdmission({ maxKeys: maxConnections, capacity: limits.framesPerSecond, refillPerSecond: limits.framesPerSecond });
  const integrity: Integrity<A, SessionIntegrityState> | null = mode === 'off' ? null : createIntegrity<A, SessionIntegrityState>({
    rules: rules.integrity, enforcement: mode, config: rules.id, decayPerSecond: 0.5,
    limits: { maxKeys: rules.maxPlayers * 4, maxHistoryPerKey: 16, maxAudit: 256 },
    close: { score: 5, requires: { violations: 5, withinMs: 10000 } },
  });

  const changed = () => { for (const c of conns.values()) c.publisher?.markDirty(); };
  const setWorld = (next: Readonly<{ world: SessionWorld; json: string }>) => {
    if (next.json === currentJson) return;
    current = next.world; currentJson = next.json; worldRevision++; changed();
  };
  function retire(peer: ConnectionHandle, reason: string) {
    if (!conns.has(peer)) return;
    overrides.set(peer, reason);
    intake.close(peer, 'closed-by-owner');
  }
  function freeSlot(player: string) {
    const slot = slots.get(player);
    if (!slot) return;
    slots.delete(player); keys.delete(slot.key); integrity?.forget(player);
    const next = safeWorld(rules, () => rules.leave(current, player));
    if (next) setWorld(next); else metrics.ruleErrors++;
    metrics.left++; say('left', { player });
  }
  function allocate(): string | null {
    for (let n = 1; n <= rules.maxPlayers; n++) if (!slots.has(`p${n}`)) return `p${n}`;
    return null;
  }

  const intake = createNetworkIntake({
    limits: intakeLimits,
    ports: {
      authenticate({ peer, credential, complete }) {
        const c = conns.get(peer), fields = credential as { token?: unknown; player?: unknown } | null;
        const token = fields?.token, key = fields?.player;
        if (!c || typeof token !== 'string' || typeof key !== 'string' || !sameSecret(token, joinCode)) { complete(null); return; }
        let player = keys.get(key) ?? null;
        if (player) {
          const slot = slots.get(player)!;
          if (slot.peer && slot.peer !== peer) retire(slot.peer, 'replaced');
          slot.peer = peer; slot.awaySince = null; metrics.resumed++;
        } else {
          player = allocate();
          if (!player) { overrides.set(peer, 'session-full'); complete(null); return; }
          const id = player, next = safeWorld(rules, () => rules.join(current, id));
          if (!next) { metrics.ruleErrors++; overrides.set(peer, 'rules-error'); complete(null); return; }
          slots.set(player, { key, peer, awaySince: null }); keys.set(key, player);
          setWorld(next); metrics.joined++;
        }
        c.player = player;
        complete(JSON.stringify({ player }));
      },
      authorize({ peer, principal }) {
        const player = (principal as { player?: unknown } | null)?.player;
        return typeof player === 'string' && conns.get(peer)?.player === player && slots.get(player)?.peer === peer;
      },
      dispatch({ peer, command }) {
        const c = conns.get(peer)!, player = c.player!;
        const { seq, action: value } = command as { seq: number; action: DocumentValue };
        if (seq !== c.processed + 1) { retire(peer, 'sequence'); return; }
        const tick = Math.floor(lastNow / limits.tickMs);
        let applied = false, closeReason: string | null = null;
        if (rules.action(value)) {
          const admitted = integrity?.admit(player, lastNow);
          let allowed = !admitted || admitted.action === 'allow';
          if (admitted?.action === 'close') closeReason = admitted.reason;
          const assessment = allowed && integrity
            ? integrity.assess({ command: value, state: { world: current, player, lastActionTick: c.lastActionTick }, tick }) : null;
          if (assessment && assessment.verdict !== 'ok') allowed = false;
          if (allowed) {
            const next = safeWorld(rules, () => rules.apply(current, player, value));
            if (next) { applied = true; c.lastActionTick = tick; setWorld(next); }
            else metrics.ruleErrors++;
          }
          if (assessment && integrity) {
            const recorded = integrity.record(player, assessment, lastNow, { sequence: seq, tick });
            if (recorded.action === 'close') closeReason = recorded.reason;
          }
        }
        // Applied or not, the action is consumed: the next view's `processed` lets the client's prediction reconcile.
        c.processed = seq;
        if (applied) metrics.applied++; else metrics.rejected++;
        c.publisher?.markDirty();
        if (closeReason) retire(peer, closeReason);
      },
      send(peer, json) {
        const c = conns.get(peer);
        if (!c || c.gone) return false;
        try { return ports.send(c.conn, json) === true; } catch { return false; }
      },
      close(peer, reason) {
        const c = conns.get(peer);
        const why = overrides.get(peer) ?? reason;
        overrides.delete(peer);
        if (!c) return;
        conns.delete(peer); byTransport.delete(c.conn); frames.forget(peer);
        c.publisher?.dispose();
        if (c.player) {
          const slot = slots.get(c.player);
          if (slot?.peer === peer) { slot.peer = null; slot.awaySince = lastNow; say('away', { player: c.player, reason: why }); }
        }
        metrics.closed++; closeReasons[why] = (closeReasons[why] ?? 0) + 1;
        if (!c.gone) {
          const code = CAPACITY.has(why) ? SESSION_CLOSE_CODES.capacity : AWAY.has(why) ? SESSION_CLOSE_CODES.away : SESSION_CLOSE_CODES.policy;
          try { ports.close(c.conn, code, why); } catch { /* The connection is already retired here. */ }
        }
      },
    },
  });

  function welcome(peer: ConnectionHandle) {
    const c = conns.get(peer);
    if (!c || c.publisher || intake.read(peer)?.state !== 'active') return;
    const session = randomKey(24), player = c.player!;
    c.session = session; c.pool = null;
    c.publisher = createViewPublisher({ session, limits: viewLimits, ports: {
      current: () => !disposed && conns.get(peer) === c && slots.get(player)?.peer === peer,
      project: () => {
        const seen = rules.disclose ? rules.disclose(current, player) : current;
        const entities = Object.keys(seen).sort().map(id => ({ id, incarnation: 0, fields: seen[id]! }));
        entities.push({ id: SESSION_SELF_ENTITY, incarnation: 0, fields: { player, processed: c.processed } });
        return JSON.stringify({ worldRevision, entities });
      },
      // Views are bounded by the view limits (the publisher captures every frame); the intake's message limits bound
      // small control replies and inbound actions, so views go straight to the transport port.
      send: json => {
        if (c.gone || conns.get(peer) !== c || intake.read(peer)?.state !== 'active') return false;
        let sent = false;
        try { sent = ports.send(c.conn, json) === true; } catch { sent = false; }
        if (sent) metrics.views++;
        return sent;
      },
      retire: why => retire(peer, `view-${why}`.slice(0, 64)),
    } });
    if (intake.send(peer, JSON.stringify({ v: 1, type: 'welcome', player, session })).status !== 'sent') retire(peer, 'send-refused');
    else say('joined', { player });
  }
  /** Which pre-join pool may take a new connection from `address`, or null to refuse it. */
  function admitPool(address: string | null): 'normal' | 'reserve' | null {
    let normal = 0, reserve = 0, normalHere = 0, reserveHere = 0;
    for (const c of conns.values()) {
      if (c.pool === 'normal') { normal++; if (address !== null && c.address === address) normalHere++; }
      else if (c.pool === 'reserve') { reserve++; if (address !== null && c.address === address) reserveHere++; }
    }
    if (normal < limits.maxPreJoin && normalHere < limits.maxPreJoinPerAddress) return 'normal';
    // Only worth holding while some player could come back to a slot.
    if (slots.size > 0 && reserve < limits.resumeReserve && reserveHere < limits.maxPreJoinPerAddress) return 'reserve';
    return null;
  }
  const time = (now: number) => {
    if (typeof now !== 'number' || !Number.isFinite(now) || now < 0) throw Error('session host: invalid time');
    lastNow = Math.max(lastNow, now);
    return lastNow;
  };

  return Object.freeze({
    connect(conn: C, now: number, address?: string): boolean {
      time(now);
      if (disposed || byTransport.has(conn)) return false;
      const from = typeof address === 'string' && address.length > 0 ? address.slice(0, 128) : null;
      const pool = admitPool(from);
      const opened = pool ? intake.open(lastNow) : null;
      if (!opened || opened.status !== 'opened') {
        closeReasons['connection-limit'] = (closeReasons['connection-limit'] ?? 0) + 1;
        try { ports.close(conn, SESSION_CLOSE_CODES.capacity, 'connection-limit'); } catch { /* Refused either way. */ }
        return false;
      }
      metrics.connections++;
      if (pool === 'reserve') metrics.reserveConnections++;
      conns.set(opened.peer, { conn, peer: opened.peer, player: null, session: null, publisher: null, processed: 0,
        lastFrame: lastNow, preAuthFrames: 0, lastActionTick: null, gone: false, address: from, pool, openedAt: lastNow });
      byTransport.set(conn, opened.peer);
      return true;
    },
    message(conn: C, text: string, now: number) {
      time(now);
      const peer = byTransport.get(conn), c = peer && conns.get(peer);
      if (!peer || !c) return;
      c.lastFrame = lastNow;
      if (typeof text !== 'string' || text.length > maxFrameChars) { retire(peer, 'frame-too-large'); return; }
      let frame: unknown;
      try { frame = JSON.parse(text); } catch { frame = null; }
      const f = frame as Record<string, unknown> | null, state = intake.read(peer)?.state;
      // An ack that releases this connection's one outstanding view credit is bounded by that credit (one per view),
      // so it is not charged; everything else, malformed frames included, spends a frame token first.
      const outstanding = c.publisher?.read().outstanding;
      const creditAck = !!f && f.type === 'ack' && f.session === c.session && outstanding?.sequence === f.sequence;
      if (!creditAck && frames.admit(peer, lastNow).status !== 'admitted') { retire(peer, 'rate-limit'); return; }
      if (!f || typeof f !== 'object' || f.v !== 1) { retire(peer, 'protocol'); return; }
      if (state !== 'active' && ++c.preAuthFrames > 2) { retire(peer, 'pre-auth-limit'); return; }
      if (f.type === 'join' && exactKeys(f, ['v', 'type', 'rules', 'version', 'token', 'player']) && state === 'pre-auth') {
        if (f.rules !== rules.id || f.version !== rules.version) { retire(peer, 'rules-mismatch'); return; }
        if (typeof f.token !== 'string' || f.token.length > 128 || typeof f.player !== 'string' || !SESSION_PLAYER_KEY.test(f.player)) {
          retire(peer, 'auth-rejected'); return;
        }
        // A reserve connection exists only to let a known player back in while the normal pool is full.
        if (c.pool === 'reserve' && !keys.has(f.player)) { retire(peer, 'connection-limit'); return; }
        const started = intake.authenticate(peer, JSON.stringify({ token: f.token, player: f.player }), lastNow);
        if (started.status === 'refused') { retire(peer, started.reason); return; }
        welcome(peer);
        return;
      }
      if (state !== 'active') { retire(peer, 'protocol'); return; }
      if (f.type === 'action' && exactKeys(f, ['v', 'type', 'seq', 'action']) && positiveInteger(f.seq)) {
        const queued = intake.receive(peer, JSON.stringify({ seq: f.seq, action: f.action }), lastNow);
        if (queued.status === 'refused') retire(peer, queued.reason === 'queue-limit' ? 'queue-limit' : queued.reason);
        return;
      }
      if (f.type === 'ack' && exactKeys(f, ['v', 'type', 'session', 'sequence']) && typeof f.session === 'string' && positiveInteger(f.sequence)) {
        c.publisher?.ack(f.session, f.sequence);
        return;
      }
      if (f.type === 'ping' && exactKeys(f, ['v', 'type'])) return;
      retire(peer, 'protocol');
    },
    disconnected(conn: C, now: number) {
      time(now);
      const peer = byTransport.get(conn), c = peer && conns.get(peer);
      if (!peer || !c) return;
      c.gone = true;
      retire(peer, 'transport-closed');
    },
    pump(now: number) {
      time(now);
      if (disposed) return;
      for (const [peer, c] of [...conns]) {
        if (c.pool === 'reserve' && lastNow - c.openedAt >= limits.reserveJoinMs) retire(peer, 'auth-timeout');
        else if (lastNow - c.lastFrame >= limits.idleTimeoutMs) retire(peer, 'idle-timeout');
      }
      intake.pump(lastNow);
      for (const [player, slot] of [...slots])
        if (!slot.peer && slot.awaySince !== null && lastNow - slot.awaySince >= limits.leaveAfterMs) freeSlot(player);
      for (const c of [...conns.values()]) c.publisher?.pump();
    },
    read(): SessionHostSnapshot {
      return Object.freeze({
        worldRevision, world: current, connections: conns.size,
        players: Object.freeze([...slots].map(([player, slot]) => Object.freeze({ player, connected: slot.peer !== null }))),
        metrics: Object.freeze({ ...metrics }), closeReasons: Object.freeze({ ...closeReasons }),
        integrity: Object.freeze({ mode, stats: integrity?.stats() ?? null, audit: integrity?.audit() ?? [] }),
      });
    },
    dispose() {
      if (disposed) return;
      for (const peer of [...conns.keys()]) retire(peer, 'host-closing');
      disposed = true;
      intake.dispose(); frames.dispose(); integrity?.dispose();
    },
  });
}
