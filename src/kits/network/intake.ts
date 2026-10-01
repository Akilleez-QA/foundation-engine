import { createAuthoredDocument, type DocumentLimits, type DocumentValue } from '../authoring/document';
import type { ConnectionHandle, NetworkContext, NetworkIntake, NetworkLimits, NetworkPeerState,
  NetworkPorts, NetworkReason, NetworkRefusal } from './types';

type Message = { value: DocumentValue; bytes: number };
type Slot = {
  peer: ConnectionHandle; state: NetworkPeerState['state']; opened: number;
  principal: DocumentValue | null; attempt: object | null; queue: Message[];
  bytes: number; preAuth: number; reason: NetworkReason | null;
};
const refuse = (reason: NetworkReason): NetworkRefusal => Object.freeze({ status: 'refused', reason });
const positive = (value: number): boolean => Number.isSafeInteger(value) && value > 0;
function documentLimits(input: DocumentLimits): DocumentLimits {
  const limits = { maxBytes: input.maxBytes, maxNodes: input.maxNodes, maxDepth: input.maxDepth };
  if (!Object.values(limits).every(positive)) throw Error('network: invalid document limits');
  return Object.freeze(limits);
}
function capture(json: string, limits: DocumentLimits): Message {
  const document = createAuthoredDocument({ id: 'network-data', json, limits,
    validate: (value): value is DocumentValue => value !== undefined });
  const { value, bytes } = document.read();
  document.dispose();
  return { value, bytes };
}

/** Caller-owned, bounded intake. Trusted callbacks are synchronous except explicit auth completion. */
export function createNetworkIntake(options: { limits: NetworkLimits; ports: NetworkPorts }): NetworkIntake {
  const input = options.limits;
  const limits = Object.freeze({
    maxConnections: input.maxConnections, maxPendingAuth: input.maxPendingAuth,
    maxPreAuthMessages: input.maxPreAuthMessages, authTimeoutMs: input.authTimeoutMs,
    maxQueuedMessagesPerPeer: input.maxQueuedMessagesPerPeer, maxQueuedBytesPerPeer: input.maxQueuedBytesPerPeer,
    maxQueuedMessages: input.maxQueuedMessages, maxQueuedBytes: input.maxQueuedBytes,
    maxPumpOperations: input.maxPumpOperations,
    message: documentLimits(input.message), principal: documentLimits(input.principal),
  });
  if (!Object.entries(limits).every(([key, value]) => key === 'message' || key === 'principal' || positive(value as number)))
    throw Error('network: invalid limits');
  const { authenticate: verify, authorize, dispatch, send: transmit, close: notifyClose } = options.ports;
  if (![verify, authorize, dispatch, transmit, notifyClose].every(fn => typeof fn === 'function'))
    throw Error('network: missing port');
  const live = new Map<ConnectionHandle, Slot>();
  const known = new WeakMap<ConnectionHandle, Slot>();
  const order: Slot[] = [];
  let now = 0, disposed = false, busy = false, sending = false;
  let pendingAuth = 0, queuedMessages = 0, queuedBytes = 0, cursor = 0;
  function time(next: number): void {
    if (!Number.isFinite(next) || next < now || next < 0) throw Error('network: time must be finite and monotonic');
    now = next;
  }
  function close(peer: ConnectionHandle, reason: NetworkReason = 'closed-by-owner'): void {
    const slot = live.get(peer);
    if (!slot) return;
    live.delete(peer);
    const index = order.indexOf(slot);
    order.splice(index, 1);
    if (index < cursor) cursor--;
    if (cursor >= order.length) cursor = 0;
    if (slot.state === 'pending-auth') pendingAuth--;
    queuedMessages -= slot.queue.length; queuedBytes -= slot.bytes;
    slot.queue.length = 0; slot.bytes = 0; slot.principal = null; slot.attempt = null;
    slot.state = 'closed'; slot.reason = reason;
    const wasBusy = busy; busy = true;
    try { notifyClose(peer, reason); } catch { /* Cleanup already completed; transport callback cannot resurrect ownership. */ }
    finally { busy = wasBusy; }
  }
  function expire(): number {
    let count = 0;
    for (const slot of live.values()) {
      if ((slot.state === 'pre-auth' || slot.state === 'pending-auth') && now - slot.opened >= limits.authTimeoutMs) {
        close(slot.peer, 'auth-timeout'); count++;
      }
    }
    return count;
  }
  function admission(peer?: ConnectionHandle): NetworkRefusal | null {
    if (disposed) return refuse('disposed');
    if (busy) return refuse('busy');
    if (peer && !live.has(peer)) return refuse(known.has(peer) ? 'closed' : 'unknown-peer');
    return null;
  }
  function preAuth(slot: Slot): boolean {
    if (slot.preAuth >= limits.maxPreAuthMessages) { close(slot.peer, 'pre-auth-limit'); return false; }
    slot.preAuth++;
    return true;
  }
  return Object.freeze({
    open(next: number) {
      const failure = admission(); if (failure) return failure;
      time(next); expire();
      if (disposed) return refuse('disposed');
      if (live.size >= limits.maxConnections) return refuse('connection-limit');
      const peer = Object.freeze({}) as ConnectionHandle;
      const slot: Slot = { peer, state: 'pre-auth', opened: now, principal: null, attempt: null,
        queue: [], bytes: 0, preAuth: 0, reason: null };
      live.set(peer, slot); known.set(peer, slot); order.push(slot);
      return Object.freeze({ status: 'opened' as const, peer });
    },
    authenticate(peer: ConnectionHandle, json: string, next: number) {
      const failure = admission(peer); if (failure) return failure;
      time(next); expire();
      const slot = live.get(peer); if (!slot) return refuse('closed');
      if (slot.state === 'active') return refuse('auth-state');
      if (!preAuth(slot)) return refuse('pre-auth-limit');
      if (slot.state !== 'pre-auth') return refuse('auth-state');
      if (pendingAuth >= limits.maxPendingAuth) return refuse('auth-limit');
      let credential: DocumentValue;
      try { credential = capture(json, limits.message).value; }
      catch { close(peer, 'invalid-data'); return refuse('invalid-data'); }
      const attempt = Object.freeze({});
      slot.attempt = attempt; slot.state = 'pending-auth'; pendingAuth++;
      const complete = (principalJson: string | null): void => {
        if (disposed || live.get(peer) !== slot || slot.attempt !== attempt || slot.state !== 'pending-auth') return;
        if (now - slot.opened >= limits.authTimeoutMs) { close(peer, 'auth-timeout'); return; }
        if (principalJson === null) { close(peer, 'auth-rejected'); return; }
        let principal: DocumentValue;
        try { principal = capture(principalJson, limits.principal).value; }
        catch { close(peer, 'invalid-data'); return; }
        // JSON capture invokes no creator callbacks. Completion retires its attempt before publication.
        slot.attempt = null; pendingAuth--; slot.principal = principal; slot.state = 'active';
      };
      busy = true;
      try { verify(Object.freeze({ peer, credential, complete })); }
      catch { close(peer, 'auth-error'); return refuse('auth-error'); }
      finally { busy = false; }
      return Object.freeze({ status: 'started' as const });
    },
    receive(peer: ConnectionHandle, json: string, next: number) {
      const failure = admission(peer); if (failure) return failure;
      time(next); expire();
      const slot = live.get(peer); if (!slot) return refuse('closed');
      if (slot.state !== 'active') {
        if (!preAuth(slot)) return refuse('pre-auth-limit');
        return refuse('not-active');
      }
      let message: Message;
      try { message = capture(json, limits.message); }
      catch { close(peer, 'invalid-data'); return refuse('invalid-data'); }
      if (slot.queue.length >= limits.maxQueuedMessagesPerPeer || queuedMessages >= limits.maxQueuedMessages
        || message.bytes > limits.maxQueuedBytesPerPeer - slot.bytes || message.bytes > limits.maxQueuedBytes - queuedBytes)
        return refuse('queue-limit');
      slot.queue.push(message); slot.bytes += message.bytes;
      queuedMessages++; queuedBytes += message.bytes;
      return Object.freeze({ status: 'queued' as const });
    },
    pump(next: number, budget = limits.maxPumpOperations) {
      const failure = admission(); if (failure) return failure;
      if (!Number.isSafeInteger(budget) || budget < 0 || budget > limits.maxPumpOperations) throw Error('network: invalid pump budget');
      time(next);
      const expired = expire();
      let attempted = 0, dispatched = 0, denied = 0, empty = 0;
      busy = true;
      try {
        while (!disposed && order.length && attempted < budget && empty < order.length) {
          const slot = order[cursor]!; cursor = (cursor + 1) % order.length;
          if (live.get(slot.peer) !== slot || slot.state !== 'active' || !slot.queue.length) { empty++; continue; }
          empty = 0;
          const command = slot.queue.shift()!; slot.bytes -= command.bytes;
          queuedMessages--; queuedBytes -= command.bytes; attempted++;
          const context: NetworkContext = Object.freeze({ peer: slot.peer, principal: slot.principal, command: command.value });
          let allowed: boolean;
          try { allowed = authorize(context) === true; }
          catch { close(slot.peer, 'authorize-error'); denied++; continue; }
          if (!allowed || disposed || live.get(slot.peer) !== slot || slot.state !== 'active') { denied++; continue; }
          try { dispatch(context); dispatched++; }
          catch { close(slot.peer, 'dispatch-error'); denied++; }
        }
      } finally { busy = false; }
      return Object.freeze({ status: 'pumped' as const, attempted, dispatched, denied, expired });
    },
    send(peer: ConnectionHandle, json: string) {
      if (disposed) return refuse('disposed');
      const slot = live.get(peer);
      if (!slot) return refuse(known.has(peer) ? 'closed' : 'unknown-peer');
      if (slot.state !== 'active') return refuse('not-active');
      if (sending) return refuse('busy');
      try { capture(json, limits.message); }
      catch { return refuse('invalid-data'); }
      const wasBusy = busy; busy = true; sending = true;
      try {
        if (transmit(peer, json) !== true) { close(peer, 'send-refused'); return refuse('send-refused'); }
        if (disposed || live.get(peer) !== slot) return refuse('closed');
        return Object.freeze({ status: 'sent' as const });
      } catch { close(peer, 'send-error'); return refuse('send-error'); }
      finally { busy = wasBusy; sending = false; }
    },
    close,
    revoke(peer: ConnectionHandle) { close(peer, 'revoked'); },
    read(peer: ConnectionHandle) {
      const slot = known.get(peer); if (!slot) return null;
      return Object.freeze({ state: slot.state, principal: slot.principal, queuedMessages: slot.queue.length,
        queuedBytes: slot.bytes, preAuthMessages: slot.preAuth, reason: slot.reason });
    },
    stats() { return Object.freeze({ connections: live.size, pendingAuth, queuedMessages, queuedBytes, disposed }); },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const peer of live.keys()) close(peer, 'disposed');
    },
  });
}
