import { captureViewFrame, captureViewLimits, viewIdentity } from './view-capture';
import type { ViewFrame, ViewLimits, ViewReceiver, ViewReceiverState } from './view-types';
/** One complete value; never merges fields, creates ECS entities, or learns authority from input. */
export function createViewReceiver(options: { session: string; limits: ViewLimits }): ViewReceiver {
  const limits = captureViewLimits(options.limits), session = options.session;
  if (!viewIdentity(session, limits)) throw Error('network view: invalid session');
  let state: ViewReceiverState['state'] = 'waiting', sequence = 0;
  let view: ViewFrame | null = null, reason: string | null = null, currentJson: string | null = null;
  function retire(why: string) { state = 'retired'; view = null; currentJson = null; reason = why; }
  return Object.freeze({
    receive(json: string) {
      if (state === 'retired') return Object.freeze({ status: 'retired' as const });
      let frame;
      try { frame = captureViewFrame(json, limits).value; }
      catch { retire('invalid-frame'); return Object.freeze({ status: 'retired' as const }); }
      if (frame.session !== session) return Object.freeze({ status: 'foreign' as const });
      if (frame.sequence < sequence) return Object.freeze({ status: 'obsolete' as const });
      if (frame.sequence === sequence) {
        if (currentJson === null) return Object.freeze({ status: 'obsolete' as const });
        if (json === currentJson) return Object.freeze({ status: 'duplicate' as const });
        retire('sequence-conflict'); return Object.freeze({ status: 'retired' as const });
      }
      sequence = frame.sequence; currentJson = json;
      if (frame.type === 'view-unavailable') {
        state = 'unavailable'; view = null; reason = frame.reason;
        return Object.freeze({ status: 'unavailable' as const });
      }
      state = 'ready'; view = frame; reason = null;
      return Object.freeze({ status: 'accepted' as const });
    },
    read() { return Object.freeze({ state, session, sequence, view, reason }); },
    invalidate(why = 'local-projection-failed') {
      if (state === 'retired') return;
      state = 'unavailable'; view = null; currentJson = null;
      reason = viewIdentity(why, limits) ? why : 'invalidated';
    },
    dispose() { if (state !== 'retired') retire('disposed'); },
  });
}
