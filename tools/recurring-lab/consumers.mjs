import {initialPhase, restorePhase, deadline, planDue, record} from './phase.ts';
const whole = x => Number.isSafeInteger(x) && x >= 0;
/** Creator fixture using an existing clock and existing SaveHandle; no timer loop is installed. */
function consumer({clock, save, definition, policy, kind, capacity}) {
  if (!['skip', 'coalesce', 'replay'].includes(policy)) throw Error('consumer: explicit policy required');
  definition = initialPhase(definition).definition;
  let active = true,
    busy = false,
    scheduled = null,
    lastStatus = null;
  const capture = raw => {
    const data = record(raw, ['version', 'kind', 'capacity', 'phase', 'value', 'lastFiring', 'time']);
    if (
      data.version !== 1 ||
      data.kind !== kind ||
      data.capacity !== capacity ||
      !whole(data.value) ||
      data.value > capacity ||
      !Number.isFinite(data.time) ||
      data.time < 0 ||
      data.time > Number.MAX_SAFE_INTEGER ||
      (data.lastFiring !== null && (typeof data.lastFiring !== 'string' || data.lastFiring.length > 160))
    )
      throw Error('consumer: invalid envelope');
    const phase = restorePhase(definition, data.phase);
    const expected =
      phase.lastCommitted === null
        ? null
        : JSON.stringify([phase.definition.id, phase.definition.revision, phase.lastCommitted]);
    if (data.lastFiring !== expected) throw Error('consumer: mismatched receipt');
    return Object.freeze({...data, phase});
  };
  const saved = save.get().json;
  let state = saved
    ? capture(JSON.parse(saved))
    : capture({
        version: 1,
        kind,
        capacity,
        phase: initialPhase(definition),
        value: 0,
        lastFiring: null,
        time: clock.ut,
      });
  const persist = () =>
    save.update(
      draft => {
        draft.json = JSON.stringify(state);
      },
      {now: true},
    );
  const retire = () => {
    scheduled?.abort();
    scheduled = null;
  };
  return {
    read: () => state,
    get status() {
      return lastStatus;
    },
    /** Host calls at most once per chosen dispatch boundary. Never rearms from its own callback. */
    arm() {
      if (!active || busy || scheduled) return false;
      const token = new AbortController();
      scheduled = token;
      clock.schedule(
        deadline(state.phase),
        () => {
          if (!active || scheduled !== token || token.signal.aborted) return;
          if (busy) {
            retire();
            return;
          }
          busy = true;
          try {
            const now = clock.ut;
            if (now < state.time) throw Error('consumer: timeline requires restore');
            const proposal = planDue(state.phase, now, policy);
            let value = state.value;
            for (const row of proposal.firings) {
              // Two creator semantics: capped replenishment, or count every admitted alert.
              if (kind === 'station') value += Math.min(capacity - value, row.count);
              else {
                if (row.count > capacity - value) throw Error('consumer: alert capacity');
                value += row.count;
              }
            }
            const next = capture({
              ...state,
              phase: proposal.phase,
              value,
              time: clock.ut,
              lastFiring: proposal.firings.at(-1)?.id ?? state.lastFiring,
            });
            if (!active || scheduled !== token) return;
            state = next; // Coupled receipt/outcome/phase become accepted together.
            lastStatus = 'staged'; // Save only at the host-selected boundary outside clock dispatch.
          } finally {
            if (scheduled === token) retire();
            busy = false;
          }
        },
        token.signal,
      );
      return true;
    },
    retrySave() {
      if (!active || busy) return false;
      busy = true;
      try {
        const now = clock.ut;
        if (now < state.time) throw Error('consumer: timeline requires restore');
        const next = capture({...state, time: now});
        if (!active) return false;
        state = next;
        lastStatus = persist();
        return lastStatus;
      } finally {
        busy = false;
      }
    },
    restore(raw) {
      if (!active || busy) return false;
      busy = true;
      try {
        const next = capture(raw);
        if (!active) return false;
        retire();
        state = next;
        return true;
      } finally {
        busy = false;
      }
    },
    dispose() {
      active = false;
      retire();
    },
  };
}
export function createStation(options) {
  if (!whole(options.capacity) || options.capacity < 1 || options.capacity > 4096) throw Error('station: capacity');
  return consumer({...options, kind: 'station'});
}
export function createAlerts(options) {
  if (!whole(options.capacity) || options.capacity < 1 || options.capacity > 4096) throw Error('alerts: capacity');
  return consumer({...options, kind: 'alerts'});
}
