function fact(raw) {
  if (!raw || typeof raw !== 'object') throw Error('invalid-fact');
  const {id, event, amount} = raw;
  if (
    typeof id !== 'string' ||
    !id.length ||
    id.length > 64 ||
    typeof event !== 'string' ||
    !event.length ||
    event.length > 96 ||
    !Number.isSafeInteger(amount) ||
    amount < 1
  )
    throw Error('invalid-fact');
  return Object.freeze({id, event, amount});
}
/** Finite one-result producer for the optional consumer; no timer or scheduler. */
export function createWorkSource() {
  let value = null,
    capturing = false;
  const listeners = new Set();
  return {
    read: () => value,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(raw) {
      if (value || capturing) return {status: 'refused', reason: value ? 'complete' : 'busy'};
      capturing = true;
      try {
        value = fact(raw);
      } finally {
        capturing = false;
      }
      for (const fn of [...listeners]) fn(value);
      return {status: 'emitted'};
    },
    listeners: () => listeners.size,
  };
}
/** Exact local leases. Result acceptance is per recipient and can be retried explicitly. */
export function createRelatedWork(source) {
  let closed = false,
    busy = false,
    cleanup = null,
    attaching = false,
    attachedValue = null,
    value = null,
    refused = 0,
    attachment = null,
    cleanupErrors = 0;
  const leases = new Map();
  const detach = () => {
    const fn = cleanup;
    cleanup = null;
    attachment = null;
    if (fn) fn();
  };
  const deliver = entry => {
    if (closed || !leases.has(entry.token) || !value || entry.delivered) return false;
    const token = entry.token;
    let accepted = false;
    try {
      accepted = entry.receive(value) === true;
    } catch {}
    if (closed || !leases.has(token)) return false;
    if (accepted) entry.delivered = true;
    else refused++;
    return accepted;
  };
  const reconcile = () => {
    if (closed || busy) return {status: 'refused', reason: closed ? 'retired' : 'busy'};
    busy = true;
    try {
      for (const entry of [...leases.values()]) deliver(entry);
      return {status: 'reconciled'};
    } finally {
      busy = false;
    }
  };
  const receive = raw => {
    if (closed || (!cleanup && !attaching)) return false;
    const identity = attachment,
      captured = fact(raw);
    if (closed || attachment !== identity || value) return false;
    if (attaching) {
      attachedValue = captured;
      return true;
    }
    value = captured;
    try {
      detach();
    } catch {
      cleanupErrors++;
    }
    reconcile();
    return true;
  };
  return {
    acquire(receiveResult) {
      if (closed || busy) return {status: 'refused', reason: closed ? 'retired' : 'busy'};
      if (typeof receiveResult !== 'function') throw Error('receiver');
      if (leases.size >= 2) return {status: 'refused', reason: 'capacity'};
      busy = true;
      let entry;
      try {
        if (!leases.size && !value) {
          const ready = source.read();
          if (closed) throw Error('retired');
          if (ready !== null) value = fact(ready);
          else {
            attaching = true;
            const identity = {};
            attachment = identity;
            try {
              const end = source.subscribe(raw => (attachment === identity ? receive(raw) : false));
              if (typeof end !== 'function') throw Error('cleanup');
              if (closed || attachment !== identity) {
                end();
                throw Error('retired');
              }
              cleanup = end;
            } finally {
              attaching = false;
            }
            if (attachedValue) {
              value = attachedValue;
              attachedValue = null;
              try {
                detach();
              } catch {
                cleanupErrors++;
              }
            }
          }
        }
        if (closed) throw Error('retired');
        entry = {token: Object.freeze({}), receive: receiveResult, delivered: false};
        leases.set(entry.token, entry);
      } catch (error) {
        attachedValue = null;
        try {
          detach();
        } catch {}
        return {status: 'refused', reason: error.message};
      } finally {
        busy = false;
      }
      reconcile();
      return closed || !leases.has(entry.token)
        ? {status: 'refused', reason: 'retired'}
        : {status: 'admitted', lease: entry.token};
    },
    release(token) {
      const removed = leases.delete(token);
      if (removed && !leases.size) detach();
      return removed;
    },
    reconcile,
    close() {
      if (closed) return;
      closed = true;
      leases.clear();
      detach();
    },
    stats: () =>
      Object.freeze({
        consumers: leases.size,
        listeners: cleanup ? 1 : 0,
        completed: value !== null,
        delivered: [...leases.values()].filter(e => e.delivered).length,
        refused,
        cleanupErrors,
        retired: closed,
      }),
  };
}
