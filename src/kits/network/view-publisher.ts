import {captureViewFrame, captureViewLimits, captureViewProjection, viewIdentity} from './view-capture';
import type {ViewLimits, ViewPublisher, ViewPublisherPorts, ViewPumpResult} from './view-types';

const result = (status: ViewPumpResult['status'], sequence?: number): ViewPumpResult =>
  Object.freeze(sequence === undefined ? {status} : {status, sequence});

/** Per-session complete views: one outstanding credit, one dirty marker, no snapshot outbox or scheduler. */
export function createViewPublisher(options: {
  session: string;
  limits: ViewLimits;
  ports: ViewPublisherPorts;
}): ViewPublisher {
  const limits = captureViewLimits(options.limits),
    session = options.session;
  if (!viewIdentity(session, limits)) throw Error('network view: invalid session');
  const {current, project, send, retire: notifyRetired} = options.ports;
  if (![current, project, send, notifyRetired].every(fn => typeof fn === 'function'))
    throw Error('network view: missing port');
  let retired = false,
    busy = false,
    dirty = true,
    generation = {};
  let sequence = 0,
    reason: string | null = null;
  let outstanding: Readonly<{sequence: number; bytes: number}> | null = null;
  function retire(why: string) {
    if (retired) return;
    retired = true;
    outstanding = null;
    dirty = false;
    generation = {};
    reason = why;
    try {
      notifyRetired(why);
    } catch {
      /* Ownership is already gone; failed transport cleanup cannot revive it. */
    }
  }
  function authority(): boolean {
    if (retired) return false;
    try {
      if (current() !== true) retire('authority-lost');
    } catch {
      retire('authority-error');
    }
    return !retired;
  }
  function markDirty() {
    if (retired) return;
    dirty = true;
    generation = {};
  }
  return Object.freeze({
    pump() {
      if (retired) return result('retired');
      if (busy) return result('busy');
      busy = true;
      try {
        // current() is creator code; a reentrant invalidation cannot be overwritten by this attempt.
        const beforeAuthority = generation;
        if (!authority()) return result('retired');
        if (generation !== beforeAuthority) return result('superseded');
        if (outstanding) return result('waiting');
        if (!dirty) return result('idle');
        if (sequence === Number.MAX_SAFE_INTEGER) {
          retire('sequence-exhausted');
          return result('retired');
        }
        const attempt = generation,
          next = sequence + 1;
        let json: string, bytes: number;
        try {
          const projection = captureViewProjection(project(), limits);
          json = JSON.stringify({
            v: 1,
            type: 'view',
            session,
            sequence: next,
            worldRevision: projection.worldRevision,
            entities: projection.entities,
          });
          bytes = captureViewFrame(json, limits).bytes;
        } catch {
          // Do not expose exception strings or rejected creator data in a control frame.
          json = JSON.stringify({v: 1, type: 'view-unavailable', session, sequence: next, reason: 'projection-failed'});
          try {
            bytes = captureViewFrame(json, limits).bytes;
          } catch {
            retire('unavailable-over-limit');
            return result('retired');
          }
        }
        if (retired) return result('retired');
        if (generation !== attempt) return result('superseded');
        if (!authority()) return result('retired');
        if (generation !== attempt) return result('superseded');
        // Reserve before calling transport: synchronous ack/retirement cannot duplicate this credit.
        sequence = next;
        outstanding = Object.freeze({sequence: next, bytes});
        dirty = false;
        try {
          if (send(json) !== true) {
            retire('send-refused');
            return result('retired');
          }
        } catch {
          retire('send-error');
          return result('retired');
        }
        if (!authority()) return result('retired');
        return result('sent', next);
      } finally {
        busy = false;
      }
    },
    markDirty,
    invalidateDisclosure() {
      if (retired) return;
      if (outstanding) {
        retire('disclosure-invalidated');
        return;
      }
      markDirty();
    },
    ack(ackSession: string, ackSequence: number) {
      if (retired || ackSession !== session || !outstanding || ackSequence !== outstanding.sequence) return false;
      outstanding = null;
      return true;
    },
    read() {
      return Object.freeze({
        state: retired ? ('retired' as const) : ('active' as const),
        session,
        sequence,
        outstanding,
        dirty,
        reason,
      });
    },
    dispose() {
      retire('disposed');
    },
  });
}
