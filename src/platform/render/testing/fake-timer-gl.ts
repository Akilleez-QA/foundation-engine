import assert from 'node:assert/strict';
import {GPU_DISJOINT_EXT, GPU_TIMER_EXTENSION, TIME_ELAPSED_EXT, type GpuTimerContext} from '../gpu-timer';

const QUERY_RESULT = 0x8866,
  QUERY_RESULT_AVAILABLE = 0x8867;

/** A fake WebGL2 context: queries answer when the test says so, with the elapsed ns it chooses. */
export function fakeTimerGl(o: {extension?: boolean} = {}) {
  let next = 0,
    active: {id: number} | null = null,
    lost = false,
    disjoint = false,
    extension = o.extension ?? true;
  const live = new Set<{id: number}>();
  const answers = new Map<number, number>();
  const ended: {id: number}[] = [];
  const calls: string[] = [];
  const gl: GpuTimerContext & Record<string, unknown> = {
    getExtension: name => (name === GPU_TIMER_EXTENSION && extension && !lost ? {} : null),
    createQuery() {
      if (lost) return null;
      const q = {id: ++next};
      live.add(q);
      return q;
    },
    deleteQuery(q) {
      calls.push('delete');
      live.delete(q as {id: number});
    },
    beginQuery(target, q) {
      assert.equal(target, TIME_ELAPSED_EXT);
      assert.equal(active, null, 'one active query at a time');
      assert.ok(live.has(q as {id: number}), 'query belongs to this context');
      active = q as {id: number};
      answers.delete(active.id);
      calls.push('begin');
    },
    endQuery(target) {
      assert.equal(target, TIME_ELAPSED_EXT);
      assert.ok(active, 'end follows begin');
      ended.push(active);
      active = null;
      calls.push('end');
    },
    getQueryParameter(q, p) {
      const id = (q as {id: number}).id;
      if (p === QUERY_RESULT_AVAILABLE) return answers.has(id);
      if (p === QUERY_RESULT) {
        assert.ok(answers.has(id), 'a result is read only once available (never a stall)');
        return answers.get(id);
      }
      throw Error('unexpected parameter');
    },
    getParameter(p) {
      assert.equal(p, GPU_DISJOINT_EXT);
      const d = disjoint;
      disjoint = false;
      return d;
    },
    isContextLost: () => lost,
  };
  return {
    gl,
    calls,
    live,
    /** Answer the oldest `n` ended queries with `ms` each. */
    answer(ms: number | number[], n = 1) {
      for (let i = 0; i < n; i++) {
        const q = ended.shift();
        if (!q) return;
        answers.set(q.id, (Array.isArray(ms) ? ms[i]! : ms) * 1e6);
      }
    },
    /** Answer the `index`th oldest ended query only. */
    answerAt(index: number, ms: number) {
      const [q] = ended.splice(index, 1);
      if (q) answers.set(q.id, ms * 1e6);
    },
    disjoint() {
      disjoint = true;
    },
    lose() {
      lost = true;
      live.clear();
      active = null;
      ended.length = 0;
    },
    restore() {
      lost = false;
    },
    set extension(v: boolean) {
      extension = v;
    },
  };
}
