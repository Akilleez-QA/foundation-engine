import {createAuthoredDocument} from '../../src/kits/authoring/document.ts';
import {
  initialRuntimeEnvelope,
  parseRuntimeEnvelope,
  captureCommand,
  transition,
  recoveryStates,
  project,
  runtimeLimits,
  equal,
  freeze,
} from './runtime-model.mjs';
export {initialRuntimeEnvelope, parseRuntimeEnvelope} from './runtime-model.mjs';
export const runtimeStorageKey = 'crafting-workbench|device|crafting.runtime';
export const runtimeSectionDefinition = {
  id: 'crafting.runtime',
  scope: 'device',
  version: 1,
  maxChars: 262144,
  initial: initialRuntimeEnvelope,
  parse: parseRuntimeEnvelope,
};
/** Protect this sample's one local writer, including autonomous SaveStore writes. Not distributed CAS. */
export function createRuntimeStoragePort(port) {
  let seen = false,
    expected = null,
    conflict = false;
  const bounded = raw => {
    if (
      raw !== null &&
      (typeof raw !== 'string' ||
        raw.length > runtimeSectionDefinition.maxChars ||
        new TextEncoder().encode(raw).length > runtimeLimits.maxBytes)
    ) {
      conflict = true;
      throw Error('storage-bound');
    }
    return raw;
  };
  const compare = raw => {
    if (conflict || (seen && raw !== expected)) {
      conflict = true;
      throw Error('external-conflict');
    }
  };
  const check = () => {
    compare(bounded(port.get(runtimeStorageKey)));
    if (!seen) throw Error('unobserved-storage');
  };
  return {
    kind: port.kind,
    get(key) {
      const raw = port.get(key);
      if (key === runtimeStorageKey) {
        bounded(raw);
        compare(raw);
        if (!seen) {
          seen = true;
          expected = raw;
        }
      }
      return raw;
    },
    set(key, value) {
      if (key === runtimeStorageKey) {
        check();
        port.set(key, value);
        expected = value;
      } else port.set(key, value);
    },
    remove(key) {
      if (key === runtimeStorageKey) {
        check();
        port.remove(key);
        expected = null;
      } else port.remove(key);
    },
    keys: () => port.keys(),
    ...(port.subscribe ? {subscribe: fn => port.subscribe(fn)} : {}),
  };
}
const continuations = new WeakMap();
export function createRuntimeController({saveHandle, readPersisted, saveBuild, resume}) {
  if (
    typeof readPersisted !== 'function' ||
    typeof saveBuild !== 'string' ||
    !saveBuild.length ||
    saveBuild.length > 256
  )
    throw Error('ports');
  let blocked = null,
    retired = false,
    busy = false,
    pending = null,
    terminal = null,
    message = '',
    starting = initialRuntimeEnvelope(),
    lastRaw,
    retirementToken;
  let projectedValue, projectedView, parsedRaw, parsedValue;
  const physical = raw => {
    if (raw !== parsedRaw) {
      if (
        typeof raw !== 'string' ||
        raw.length > runtimeSectionDefinition.maxChars ||
        new TextEncoder().encode(raw).length > runtimeLimits.maxBytes
      )
        throw Error('invalid-storage');
      const wrapper = JSON.parse(raw);
      if (wrapper.v !== 1 || Object.keys(wrapper).some(k => !['v', 'by', 'data'].includes(k))) throw Error('version');
      parsedValue = parseRuntimeEnvelope(wrapper.data);
      parsedRaw = raw;
    }
    return parsedValue;
  };
  let continuation;
  try {
    const status = saveHandle.status();
    if (['quarantined', 'newer', 'unavailable'].includes(status)) throw Error(`recovery-required:${status}`);
    lastRaw = readPersisted();
    starting = lastRaw === null ? initialRuntimeEnvelope() : physical(lastRaw);
    const memory = parseRuntimeEnvelope(saveHandle.get());
    if (resume !== undefined && resume !== null) {
      continuation = continuations.get(resume);
      continuations.delete(resume);
      if (!continuation || continuation.saveBuild !== saveBuild) throw Error('invalid-continuation');
      if (continuation.blocked) throw Error(continuation.blocked);
      const expected = continuation.pending ?? continuation.accepted;
      if (!equal(memory, expected) || (lastRaw !== continuation.lastRaw && !equal(starting, expected)))
        throw Error('external-conflict');
      starting = continuation.accepted;
    } else if (!equal(memory, starting)) throw Error('unacknowledged-memory');
  } catch (error) {
    blocked = error.message;
    continuation = null;
  }
  const document = createAuthoredDocument({
      id: 'crafting-runtime',
      json: JSON.stringify(starting),
      limits: runtimeLimits,
      validate: v => {
        try {
          parseRuntimeEnvelope(v);
          return true;
        } catch {
          return false;
        }
      },
    }),
    candidates = new WeakSet();
  if (continuation?.pending && !blocked) {
    const prepared = document.prepare(document.read().ticket, () => JSON.stringify(continuation.pending));
    if (prepared.status === 'prepared') {
      pending = prepared.candidate;
      candidates.add(pending);
    } else blocked = 'invalid-continuation';
  }
  const observe = () => {
    let saveStatus = 'unavailable',
      durable = false,
      canAcknowledge = false;
    try {
      saveStatus = saveHandle.status();
      if (['quarantined', 'newer', 'unavailable'].includes(saveStatus)) blocked ??= `recovery-required:${saveStatus}`;
      const accepted = document.read().value,
        expected = pending?.value ?? accepted;
      if (!equal(saveHandle.get(), expected)) blocked ??= 'external-conflict';
      const raw = readPersisted();
      if (raw !== null) {
        const stored = physical(raw),
          matches = equal(stored, expected);
        if (raw !== lastRaw && !matches) blocked ??= 'external-conflict';
        durable = saveStatus === 'saved' && equal(stored, accepted);
        canAcknowledge = !!pending && saveStatus === 'saved' && matches;
        if (matches) lastRaw = raw;
      } else if (lastRaw !== null && lastRaw !== undefined) blocked ??= 'external-conflict';
    } catch (error) {
      blocked ??= `recovery-required:${error.message}`;
    }
    return {
      saveStatus,
      durable: durable && !blocked,
      canAcknowledge: canAcknowledge && !blocked && !retired,
    };
  };
  const read = () => {
    if (terminal) return terminal;
    const persistence = observe(),
      envelope = document.read().value;
    if (envelope !== projectedValue) {
      projectedView = project(envelope);
      projectedValue = envelope;
    }
    return Object.freeze({
      envelope,
      view: projectedView,
      ...persistence,
      pending: !!pending,
      blocked,
      retired,
      message,
    });
  };
  const refused = reason => ({status: 'refused', reason});
  const guard = fn => {
    if (retired) return refused('retired');
    if (busy) return refused('busy');
    busy = true;
    try {
      observe();
      if (retired) return refused('retired');
      if (blocked) return refused(blocked);
      return fn();
    } catch (error) {
      message = error.message;
      return refused(error.message);
    } finally {
      busy = false;
    }
  };
  const write = () => {
    const exact = pending;
    try {
      saveHandle.update(
        draft => {
          if (retired || pending !== exact) throw Error('retired');
          for (const key of Object.keys(draft)) delete draft[key];
          Object.assign(draft, structuredClone(exact.value));
        },
        {now: true},
      );
    } catch (error) {
      message = error.message;
    }
    if (retired) return refused('retired');
    return {status: 'pending', canAcknowledge: observe().canAcknowledge};
  };
  return {
    read,
    preview: raw =>
      guard(() => {
        if (pending) return refused('pending');
        const ticket = document.read().ticket,
          c = captureCommand(raw);
        if (retired || document.read().ticket !== ticket) return refused('retired');
        const next = transition(document.read().value, c);
        if (!next) return {status: 'duplicate'};
        for (const future of [next, ...recoveryStates(next)]) {
          const wrapper = JSON.stringify({v: 1, by: saveBuild, data: future});
          if (
            wrapper.length > runtimeSectionDefinition.maxChars ||
            new TextEncoder().encode(wrapper).length > runtimeLimits.maxBytes
          )
            return refused('storage-capacity');
        }
        const result = document.prepare(ticket, () => JSON.stringify(next));
        if (result.status === 'prepared') candidates.add(result.candidate);
        return result;
      }),
    commit: candidate =>
      guard(() => {
        if (pending) return refused('pending');
        if (!candidates.has(candidate) || candidate.ticket !== document.read().ticket) return {status: 'stale'};
        pending = candidate;
        return write();
      }),
    cancel: candidate =>
      guard(() => {
        if (pending) return refused('pending');
        if (!candidates.has(candidate)) return {status: 'stale'};
        candidates.delete(candidate);
        document.discard(candidate);
        return {status: 'cancelled'};
      }),
    retry: () => guard(() => (pending ? write() : refused('no-pending'))),
    acknowledge: () =>
      guard(() => {
        if (!pending) return refused('no-pending');
        if (!observe().canAcknowledge || retired) return refused('not-durable');
        const result = document.publish(pending);
        if (result.status === 'accepted') {
          candidates.delete(pending);
          pending = null;
        }
        return {status: result.status};
      }),
    dispose() {
      if (retired) return retirementToken;
      retired = true;
      const envelope = document.read().value;
      retirementToken = Object.freeze({});
      continuations.set(retirementToken, {
        accepted: envelope,
        pending: pending?.value ?? null,
        lastRaw,
        saveBuild,
        blocked,
      });
      terminal = freeze({
        envelope,
        view: project(envelope),
        pending: !!pending,
        blocked,
        retired: true,
        message,
        saveStatus: 'unavailable',
        durable: false,
        canAcknowledge: false,
      });
      document.dispose();
      return retirementToken;
    },
  };
}
