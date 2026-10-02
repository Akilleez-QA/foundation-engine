/**
 * Optional game-facing shared-session client (MP-01). One owner per scene visit: construct in `enter`, call
 * `update(ctx.time.now)` from a frame system, `act(action)` from a fixed system, `dispose()` in `exit`.
 *
 * It composes existing owners: the browser text transport, the complete-view receiver (NW-02), bounded prediction
 * with reconciliation (NW-03 prediction), paced reconnect (NW-04 retry schedule) and the close policy. Without an
 * endpoint it runs the same rules locally for one player, so a game works offline and in headless tests.
 * Commands are never resent after a loss: a reconnect starts a fresh connection, baseline and prediction owner.
 */
import type { DocumentValue } from '../authoring/document';
import { createRng } from '../../core/rng';
import { createBrowserTransport, type BrowserRemoteClose, type BrowserTransportOptions } from '../../platform/network/browser-transport';
import { createClosePolicy, type CloseClass, type ClosePolicyOptions } from './close-policy';
import { createPrediction } from './prediction';
import type { Prediction } from './prediction-types';
import { createRetrySchedule, type RetryScheduleLimits } from './retry-schedule';
import { createViewReceiver } from './view-receiver';
import type { ViewFrame, ViewReceiver } from './view-types';
import { safeWorld, type SessionRules, type SessionWorld } from './session-rules';
import {
  exactKeys, randomKey, SESSION_SELF_ENTITY, SESSION_TERMINAL_CODES, SESSION_TERMINAL_REASONS, sessionViewLimits,
} from './session-protocol';

export interface SessionEndpoint {
  /** `ws:` or `wss:` URL of the session host. */
  readonly url: string;
  /** The host's join code. */
  readonly joinCode: string;
}
export interface SessionClientOptions<A extends DocumentValue> {
  readonly rules: SessionRules<A>;
  /** Null or omitted: local play, the same rules in this page for one player `p1`. */
  readonly endpoint?: SessionEndpoint | null;
  /** Reconnect jitter in [0, 1): a dedicated seeded stream, never the gameplay `ctx.random()`. */
  readonly random?: () => number;
  /** Reconnect pacing. Default: 250 ms base, 4 s cap, 6 attempts, budget 8 refilling one per 15 s. */
  readonly retry?: RetryScheduleLimits;
  /** Which host closes stop reconnecting. Default: `SESSION_TERMINAL_REASONS` and `SESSION_TERMINAL_CODES`. */
  readonly closePolicy?: ClosePolicyOptions;
  /** Keep-alive interval while joined (the reference host closes silent connections). Default 5000 ms. */
  readonly pingMs?: number;
  /** Unconfirmed predicted actions. At the bound `act` refuses `busy`. Default 32. */
  readonly maxPending?: number;
  /** Trusted test seam: the socket the transport owns. */
  readonly socketFactory?: BrowserTransportOptions['socketFactory'];
}
export type SessionStatus = 'local' | 'connecting' | 'joined' | 'reconnecting' | 'closed';
export interface SessionSnapshot {
  readonly status: SessionStatus;
  readonly player: string | null;
  /** What to draw: predicted when joined, otherwise the last confirmed world (see `stale`). */
  readonly world: SessionWorld;
  /** Last world the host confirmed for this player (local mode: the local world). */
  readonly confirmed: SessionWorld | null;
  /** Increments whenever `world` changes value: redraw only when it moved. */
  readonly revision: number;
  /** True when `world` is a last-known copy (reconnecting, closed or waiting for a baseline). */
  readonly stale: boolean;
  readonly pending: number;
  /** Validated host close: untrusted remote tokens, display as text only. */
  readonly lastClose: Readonly<{ code: number | null; reason: string | null; class: CloseClass }> | null;
  /** Why the session closed (`closed` only): a host reason token, `retry-exhausted` or `disposed`. */
  readonly reason: string | null;
  /** Host-time ms of the next reconnect attempt, when waiting. */
  readonly retryAt: number | null;
  readonly reconnects: number;
}
export interface Session<A extends DocumentValue> {
  /** Drive from a frame system with page-monotonic ms (`ctx.time.now`): intake, views, keep-alive, reconnect. */
  update(now: number): void;
  /** Apply (local) or predict and send (online) one action. Never throws for an ordinary refusal. */
  act(action: A): Readonly<{ status: 'applied' | 'predicted' } | { status: 'refused'; reason: string }>;
  read(): SessionSnapshot;
  /** Idempotent: closes the transport and stops reconnecting. */
  dispose(): void;
}

const DEFAULT_RETRY: RetryScheduleLimits = Object.freeze({ baseMs: 250, capMs: 4000, maxAttempts: 6,
  budget: Object.freeze({ capacity: 8, refillEveryMs: 15000 }) });
const plainObject = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value);
const refused = (reason: string) => Object.freeze({ status: 'refused' as const, reason });

export function createSession<A extends DocumentValue>(options: SessionClientOptions<A>): Session<A> {
  const { rules } = options;
  if (!rules || rules.kind !== 'session-rules') throw Error('session: rules must come from defineSessionRules');
  const endpoint = options.endpoint ?? null;
  const pingMs = options.pingMs ?? 5000, maxPending = options.maxPending ?? 32;
  if (!Number.isSafeInteger(pingMs) || pingMs < 100 || !Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 1024)
    throw Error('session: invalid pingMs or maxPending');
  if (endpoint && (typeof endpoint.url !== 'string' || typeof endpoint.joinCode !== 'string')) throw Error('session: invalid endpoint');
  const viewLimits = sessionViewLimits(rules.limits);
  const transportLimits = Object.freeze({ maxMessageBytes: viewLimits.maxBytes, maxQueuedMessages: 8,
    maxQueuedBytes: viewLimits.maxBytes * 4, maxBufferedBytes: 16384 });
  // Each page gets its own key so a reconnect resumes its slot; a reload is a new player.
  const playerKey = randomKey(24);

  let status: SessionStatus = endpoint ? 'connecting' : 'local', disposed = false, lastNow = 0;
  let player: string | null = null, confirmed: SessionWorld | null = null, shown: SessionWorld, shownJson = '';
  let revision = 0, reconnects = 0, reason: string | null = null, retryAt: number | null = null, budgetUntil: number | null = null;
  let lastClose: SessionSnapshot['lastClose'] = null, everJoined = false, started = false;
  let transport: ReturnType<typeof createBrowserTransport> | null = null, receiver: ViewReceiver | null = null;
  let prediction: Prediction | null = null, session: string | null = null, joinSent = false, lastSentAt = 0;

  const local = endpoint ? null : safeWorld(rules, () => rules.join(rules.initial(), 'p1'));
  if (!endpoint && !local) throw Error('session: rules.join(initial, "p1") returned an invalid world');
  shown = local?.world ?? (safeWorld(rules, rules.initial)?.world ?? {});
  if (local) { player = 'p1'; confirmed = local.world; shownJson = local.json; }

  const policy = createClosePolicy(options.closePolicy ?? { terminalReasons: SESSION_TERMINAL_REASONS, terminalCodes: SESSION_TERMINAL_CODES });
  const retry = endpoint ? createRetrySchedule({ limits: options.retry ?? DEFAULT_RETRY,
    random: options.random ?? createRng(`foundation.session.reconnect:${randomKey(12)}`).next }) : null;

  function show(world: SessionWorld) {
    const json = JSON.stringify(world);
    if (json === shownJson) return;
    shown = world; shownJson = json; revision++;
  }
  function refresh() {
    const snapshot = prediction?.read();
    if (snapshot && snapshot.status !== 'ready') { fail('prediction-' + (snapshot.reason ?? 'unavailable')); return; }
    const predicted = snapshot?.predicted?.value;
    if (predicted && plainObject(predicted)) show(predicted as SessionWorld);
    else if (confirmed) show(confirmed);
  }
  function teardown() {
    receiver?.dispose(); prediction?.dispose(); transport?.dispose();
    receiver = null; prediction = null; transport = null; session = null; joinSent = false;
  }
  function open() {
    retryAt = null;
    try { transport = createBrowserTransport({ url: endpoint!.url, limits: transportLimits, socketFactory: options.socketFactory }); }
    catch { transport = null; status = 'closed'; reason = 'invalid-endpoint'; retry?.cancel(); }
  }
  function schedule() {
    const next = retry!.next(lastNow);
    if (next.status === 'wait') { retryAt = next.untilMs; status = everJoined ? 'reconnecting' : 'connecting'; }
    else if (next.status === 'budget-empty') { budgetUntil = next.refillAtMs; retryAt = next.refillAtMs; status = everJoined ? 'reconnecting' : 'connecting'; }
    else { status = 'closed'; reason = 'retry-exhausted'; retryAt = null; }
  }
  /** Lost the connection: classify the host's close, then stop or pace a fresh attempt. */
  function lost(remote: BrowserRemoteClose | null, local: string) {
    teardown();
    const kind = policy.classify(remote);
    lastClose = Object.freeze({ code: remote?.code ?? null, reason: remote?.reason ?? local, class: kind });
    if (kind === 'terminal') { status = 'closed'; reason = remote?.reason ?? `code-${remote?.code}`; retryAt = null; retry!.cancel(); return; }
    schedule();
  }
  /** A local protocol or prediction failure: resynchronise through a fresh connection, paced like a loss. */
  function fail(why: string) { lost(null, why.slice(0, 64)); }
  function send(frame: Record<string, unknown>): boolean {
    if (!transport) return false;
    const result = transport.send(JSON.stringify(frame));
    if (result.status !== 'sent') { fail('send-' + result.reason); return false; }
    lastSentAt = lastNow;
    return true;
  }
  function adopt(view: ViewFrame): boolean {
    const self = view.entities.find(e => e.id === SESSION_SELF_ENTITY);
    const fields = self?.fields as { player?: unknown; processed?: unknown } | undefined;
    if (!fields || !exactKeys(fields, ['player', 'processed']) || fields.player !== player
      || !Number.isSafeInteger(fields.processed) || (fields.processed as number) < 0) return false;
    const world: Record<string, DocumentValue> = {};
    for (const e of view.entities) if (e.id !== SESSION_SELF_ENTITY) world[e.id] = e.fields;
    const baseline = { revision: view.sequence, processedThrough: fields.processed as number, stateJson: JSON.stringify(world) };
    try {
      if (!prediction) {
        const me = player!;
        prediction = createPrediction({
          epoch: session!, baseline,
          limits: { state: rules.limits.world, input: rules.limits.action, maxPending,
            maxPendingBytes: maxPending * rules.limits.action.maxBytes, maxReplaySteps: maxPending },
          validateState: plainObject, validateInput: value => rules.action(value),
          reduce: (state, input) => JSON.stringify(rules.apply(state as SessionWorld, me, input as A)),
        });
      } else {
        const result = prediction.reconcile({ epoch: session!, ...baseline });
        if (!['reconciled', 'duplicate', 'obsolete'].includes(result.status)) return false;
      }
    } catch { return false; }
    confirmed = Object.freeze(world);
    return true;
  }
  function receive(raw: string): boolean {
    let frame: unknown;
    try { frame = JSON.parse(raw); } catch { return false; }
    if (!receiver) {
      const f = frame as Record<string, unknown>;
      if (!exactKeys(f, ['v', 'type', 'player', 'session']) || f.v !== 1 || f.type !== 'welcome'
        || typeof f.player !== 'string' || !/^p\d{1,2}$/.test(f.player)
        || typeof f.session !== 'string' || f.session.length < 1 || f.session.length > 64) return false;
      if (everJoined && player !== f.player) confirmed = null;
      player = f.player; session = f.session;
      receiver = createViewReceiver({ session, limits: viewLimits });
      if (everJoined) reconnects++;
      everJoined = true; status = 'joined'; reason = null;
      retry!.succeeded(lastNow);
      return true;
    }
    const result = receiver.receive(raw), state = receiver.read();
    if (state.state === 'retired') return false;
    if (result.status === 'accepted' && (!state.view || !adopt(state.view))) return false;
    // The host could not project this player's view: in-flight actions cannot be renumbered, so resynchronise.
    if (result.status === 'unavailable') return false;
    if (result.status === 'accepted' || result.status === 'duplicate')
      return send({ v: 1, type: 'ack', session: state.session, sequence: state.sequence });
    return true;
  }

  return Object.freeze({
    update(now: number) {
      if (disposed || !endpoint) return;
      if (typeof now !== 'number' || !Number.isFinite(now) || now < 0) throw Error('session: invalid time');
      lastNow = Math.max(lastNow, now);
      if (!transport) {
        if (status === 'closed') return;
        if (budgetUntil !== null) { if (lastNow >= budgetUntil) { budgetUntil = null; schedule(); } return; }
        if (!started) { started = true; open(); return; }
        if (retry!.due(lastNow)) open();
        return;
      }
      const owned = transport;
      if (owned.read().state === 'open' && !joinSent) {
        joinSent = send({ v: 1, type: 'join', rules: rules.id, version: rules.version, token: endpoint.joinCode, player: playerKey });
        if (!joinSent) return;
      }
      for (const raw of owned.drain(4)) {
        if (!receive(raw)) { if (transport === owned) fail('protocol'); return; }
        if (transport !== owned) return;
      }
      refresh();
      if (transport !== owned) return;
      const read = owned.read();
      if (read.state === 'closed' || read.state === 'disposed') { lost(read.remoteClose, read.reason ?? 'closed'); return; }
      if (receiver && lastNow - lastSentAt >= pingMs) send({ v: 1, type: 'ping' });
    },
    act(action: A) {
      if (disposed) return refused('disposed');
      if (!rules.action(action)) return refused('invalid-action');
      if (!endpoint) {
        const next = safeWorld(rules, () => rules.apply(confirmed!, 'p1', action));
        if (!next) return refused('rule-error');
        confirmed = next.world; show(next.world);
        return Object.freeze({ status: 'applied' as const });
      }
      if (status !== 'joined' || !prediction || !transport) return refused('not-joined');
      if (prediction.read().pending.length >= maxPending) return refused('busy');
      const pushed = prediction.push(JSON.stringify(action));
      if (pushed.status !== 'predicted') { fail('prediction-' + pushed.status); return refused('resync'); }
      if (!send({ v: 1, type: 'action', seq: pushed.input.sequence, action: pushed.input.value })) return refused('resync');
      refresh();
      return Object.freeze({ status: 'predicted' as const });
    },
    read(): SessionSnapshot {
      const live = status === 'local' || (status === 'joined' && prediction !== null);
      return Object.freeze({ status, player, world: shown, confirmed, revision, stale: !live,
        pending: prediction?.read().pending.length ?? 0, lastClose, reason, retryAt, reconnects });
    },
    dispose() {
      if (disposed) return;
      disposed = true; teardown(); retry?.dispose();
      if (status !== 'local') { status = 'closed'; reason ??= 'disposed'; }
    },
  });
}

/** Loopback, private IPv4 (10/8, 172.16/12, 192.168/16), link-local, `.local` or `.localhost` names. Not a security check. */
export function isLocalNetworkHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)?.slice(1).map(Number);
  if (!ip || ip.some(n => n > 255)) return false;
  const [a, b] = ip as [number, number];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/**
 * The endpoint the page was opened with: `?host=<port | ws://address:port/session>&join=<code>`, as `npm run host`
 * prints. A bare port means this page's own host name. Only local-network hosts are accepted; anything else, or a
 * missing or malformed value, returns null (local play). This guard keeps a stray link from pointing a dev build at
 * a remote server; it is not authentication.
 */
export function sessionEndpointFromPage(page: { readonly search: string; readonly hostname: string } | undefined =
  (globalThis as { location?: { search: string; hostname: string } }).location): SessionEndpoint | null {
  if (!page) return null;
  const params = new URLSearchParams(page.search);
  const host = params.get('host'), joinCode = params.get('join');
  if (!host || !joinCode || !/^[A-Za-z0-9_-]{16,128}$/.test(joinCode) || host.length > 256) return null;
  const pageHost = page.hostname.includes(':') && !page.hostname.startsWith('[') ? `[${page.hostname}]` : page.hostname;
  const raw = /^\d{1,5}$/.test(host) ? `ws://${pageHost}:${host}/session` : host;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash || !isLocalNetworkHost(url.hostname)) return null;
  return Object.freeze({ url: url.href, joinCode });
}
