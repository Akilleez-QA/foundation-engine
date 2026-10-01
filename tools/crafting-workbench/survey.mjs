import { createSurvey } from '../../src/kits/resources/deposits.ts';

// A local observation lease; stock and harvest authority remain with the runtime.
export function createSurveyAdapter({ readRuntime }) {
  let retired = false,
    busy = false,
    current = null,
    serial = 0;
  const snapshot = (id) => {
    const view = readRuntime();
    if (retired || view.retired || view.blocked) return null;
    const spawn = view.view.spawns.find((s) => s.id === id);
    return spawn && view.view.clock < spawn.deposit.expiresTick
      ? { spawn, clock: view.view.clock }
      : null;
  };
  const same = (lease) => {
    const next = snapshot(lease.id);
    return (
      !!next &&
      next.spawn.incarnation === lease.incarnation &&
      JSON.stringify(next.spawn.deposit) === lease.facts
    );
  };
  const stop = () => {
    current?.job.cancel();
    current = null;
  };
  function execute(lease) {
    if (retired) return { status: 'retired' };
    if (busy) return { status: 'busy' };
    if (current !== lease) return { status: 'stale' };
    busy = true;
    try {
      if (!same(lease) || retired || current !== lease) {
        lease.job.cancel();
        return { status: 'stale' };
      }
      const batch = lease.job.step(8, lease.revision);
      if (!same(lease) || retired || current !== lease) {
        lease.job.cancel();
        return { status: 'stale' };
      }
      lease.result = batch.result;
      return { status: batch.result.status, sampled: batch.sampled };
    } finally {
      busy = false;
    }
  }
  return {
    start(id) {
      if (retired) return { status: 'retired' };
      if (busy) return { status: 'busy' };
      busy = true;
      try {
        const next = snapshot(id);
        if (!next || retired) return { status: 'unavailable' };
        if (serial === Number.MAX_SAFE_INTEGER) return { status: 'capacity' };
        const job = createSurvey(next.spawn.deposit, {
          x: 0,
          z: 0,
          spacing: 1,
          columns: 8,
          rows: 8,
        });
        if (retired) return { status: 'retired' };
        stop();
        current = {
          id,
          incarnation: next.spawn.incarnation,
          revision: next.spawn.deposit.revision,
          facts: JSON.stringify(next.spawn.deposit),
          serial: ++serial,
          job,
          result: job.result,
        };
        return { status: 'started' };
      } finally {
        busy = false;
      }
    },
    step() {
      return current
        ? execute(current)
        : { status: retired ? 'retired' : 'empty' };
    },
    capture() {
      const lease = current;
      return () => (lease ? execute(lease) : { status: 'empty' });
    },
    cancel() {
      if (busy) return { status: 'busy' };
      stop();
      return { status: retired ? 'retired' : 'cancelled' };
    },
    read() {
      if (!current)
        return { status: retired ? 'retired' : 'empty', points: [] };
      if (!same(current) || retired) return { status: 'stale', points: [] };
      return {
        status: current.result.status,
        spawn: current.id,
        incarnation: current.incarnation,
        points:
          current.result.status === 'complete' ? current.result.points : [],
      };
    },
    dispose() {
      retired = true;
      stop();
    },
  };
}
