import { captureJson } from './captured-json';
import {
  authorityIdentity,
  authorityInteger,
  captureAuthorityEnvelope,
  captureAuthorityLimits,
} from './authority-envelope';
import type {
  AuthorityCommand,
  AuthorityOptions,
  AuthorityOutcome,
  AuthoritySnapshot,
  AuthorityStatus,
  AuthoritySubmitOptions,
  AuthorityValidation,
} from './authority-types';
export { createAuthorityGenesis } from './authority-envelope';
export type * from './authority-types';

/** Optional serialized durable authority. No scheduler, queue, automatic initialization or reducer retry. */
export function createDurableAuthority(options: AuthorityOptions) {
  const lineage = options.lineage,
    schema = options.schema,
    limits = captureAuthorityLimits(options.limits),
    minimumRevision = options.minimumRevision ?? 0;
  const validate: AuthorityValidation = {
    lineage,
    schema,
    limits,
    validateState: options.validateState,
    validateInput: options.validateInput,
    validateResult: options.validateResult,
  };
  const authorize = options.authorize,
    reduce = options.reduce,
    storage = options.storage,
    clock = options.clock;
  if (
    !authorityIdentity(lineage) ||
    !authorityIdentity(schema) ||
    !authorityInteger(minimumRevision)
  )
    throw Error('authority: identity or floor');
  if (
    ![
      authorize,
      reduce,
      validate.validateState,
      validate.validateInput,
      validate.validateResult,
      storage.settle,
      storage.read,
      storage.compareAndSwap,
    ].every((fn) => typeof fn === 'function')
  )
    throw Error('authority: callbacks');
  if (clock !== undefined && typeof clock !== 'function')
    throw Error('authority: clock');
  const settle = storage.settle.bind(storage),
    readStorage = storage.read.bind(storage),
    compareAndSwap = storage.compareAndSwap.bind(storage);
  let status: AuthorityStatus = 'unrecovered',
    busy = false,
    retired = false,
    floor = minimumRevision,
    reason: string | null = null,
    current: AuthoritySnapshot | null = null;
  for (const key of [
    'validateState',
    'validateInput',
    'validateResult',
  ] as const) {
    const callback = validate[key];
    validate[key] = (value) => {
      if (retired) throw Error('authority: retired validator');
      const valid = callback(value);
      if (retired) throw Error('authority: retired validator');
      return valid;
    };
  }
  const result = (value: AuthorityOutcome): AuthorityOutcome =>
    Object.freeze(value);
  const unavailable = (
    why: string,
    state: 'unknown' | 'unavailable' = 'unavailable',
  ) => {
    status = state;
    reason = why;
    return result({ status: state });
  };
  const live = () => !retired;
  const stableRead = (next: AuthoritySnapshot) => {
    if (next.envelope.revision < floor) throw Error('rollback');
    if (current) {
      if (
        next.envelope.revision === current.envelope.revision &&
        next.json !== current.json
      )
        throw Error('revision conflict');
      for (const prior of current.envelope.streams) {
        const found = next.envelope.streams.find((s) => s.id === prior.id);
        if (!found || found.through < prior.through)
          throw Error('stream rollback');
        // Retention may evict an old prefix, but observed overlapping facts are immutable.
        const first = found.receipts[0]?.sequence ?? 1;
        for (const receipt of prior.receipts) {
          if (receipt.sequence < first) continue;
          const overlap = found.receipts[receipt.sequence - first];
          // Both snapshots came from canonical capture, including nested key ordering.
          if (!overlap || JSON.stringify(receipt) !== JSON.stringify(overlap))
            throw Error('receipt conflict');
        }
      }
    }
  };
  return Object.freeze({
    read() {
      return Object.freeze({
        status,
        snapshot: status === 'ready' ? current : null,
        lastConfirmed: current,
        floor,
        reason,
      });
    },
    async recover(): Promise<AuthorityOutcome> {
      if (retired) return result({ status: 'retired' });
      if (busy) return result({ status: 'busy' });
      busy = true;
      status = 'pending';
      reason = null;
      try {
        await settle();
        if (!live()) return result({ status: 'retired' });
        const raw = await readStorage();
        if (!live()) return result({ status: 'retired' });
        if (raw === null) return unavailable('missing');
        const next = captureAuthorityEnvelope(raw, validate);
        if (!live()) return result({ status: 'retired' });
        stableRead(next);
        current = next;
        floor = Math.max(floor, next.envelope.revision);
        status = 'ready';
        return result({ status: 'recovered', revision: floor });
      } catch {
        if (!live()) return result({ status: 'retired' });
        return unavailable('recovery-failed');
      } finally {
        busy = false;
      }
    },
    async submit(
      request: AuthorityCommand,
      admission?: AuthoritySubmitOptions,
    ): Promise<AuthorityOutcome> {
      if (retired) return result({ status: 'retired' });
      if (busy) return result({ status: 'busy' });
      if (status !== 'ready' || !current)
        return result({ status: 'unavailable' });
      let deadline: number | undefined;
      if (admission !== undefined) {
        try {
          deadline = admission.deadlineMs;
        } catch {
          deadline = NaN;
        }
        if (
          clock === undefined ||
          typeof deadline !== 'number' ||
          !Number.isFinite(deadline)
        )
          return result({ status: 'refused', reason: 'deadline' });
      }
      // Reads the injected clock only while no storage call has started. Non-monotonic
      // readings are compared as given; a later reading may pass after an earlier one.
      const lapsed = (): AuthorityOutcome | null => {
        if (deadline === undefined) return null;
        let time: number;
        try {
          time = clock!();
        } catch {
          return result({ status: 'refused', reason: 'clock' });
        }
        if (typeof time !== 'number' || !Number.isFinite(time))
          return result({ status: 'refused', reason: 'clock' });
        return time >= deadline ? result({ status: 'expired' }) : null;
      };
      busy = true;
      status = 'pending';
      reason = null;
      let invoked = false;
      try {
        const stream = request.stream,
          sequence = request.sequence,
          inputJson = request.inputJson;
        if (!live()) return result({ status: 'retired' });
        // First admission point: shed abandoned work before validation, receipts or reduction.
        const early = lapsed();
        if (!live()) return result({ status: 'retired' });
        if (early) return early;
        if (
          !authorityIdentity(stream) ||
          !authorityInteger(sequence) ||
          sequence === 0
        )
          return result({ status: 'refused', reason: 'command' });
        const input = captureJson(
          inputJson,
          limits.input,
          validate.validateInput,
        );
        if (!live()) return result({ status: 'retired' });
        const context = Object.freeze({
          stream,
          sequence,
          input: input.value,
          state: current.envelope.state,
        });
        const permitted = authorize(context);
        if (!live()) return result({ status: 'retired' });
        if (permitted !== true)
          return result({ status: 'refused', reason: 'unauthorized' });
        const prior = current.envelope.streams.find((s) => s.id === stream),
          through = prior?.through ?? 0;
        if (sequence <= through) {
          const receipt = prior!.receipts.find((r) => r.sequence === sequence);
          if (!receipt) return result({ status: 'result-unavailable' });
          const canonical = captureJson(
            JSON.stringify(receipt.input),
            limits.input,
          ).json;
          if (canonical !== input.json) return result({ status: 'conflict' });
          return result({
            status: 'duplicate',
            revision: receipt.revision,
            sequence,
            result: receipt.result,
          });
        }
        if (
          current.envelope.revision === Number.MAX_SAFE_INTEGER ||
          through === Number.MAX_SAFE_INTEGER
        )
          return result({ status: 'exhausted' });
        if (sequence !== through + 1) return result({ status: 'gap' });
        if (!prior && current.envelope.streams.length >= limits.maxStreams)
          return result({ status: 'refused', reason: 'streams-full' });
        const reduced = reduce(context);
        if (!live()) return result({ status: 'retired' });
        const state = captureJson(
          reduced.stateJson,
          limits.state,
          validate.validateState,
        );
        if (!live()) return result({ status: 'retired' });
        const output = captureJson(
          reduced.resultJson,
          limits.result,
          validate.validateResult,
        );
        if (!live()) return result({ status: 'retired' });
        const revision = current.envelope.revision + 1;
        const receipts = [
          ...(prior?.receipts ?? []),
          { sequence, revision, input: input.value, result: output.value },
        ].slice(-limits.maxReceiptsPerStream);
        const row = { id: stream, through: sequence, receipts };
        const streams = prior
          ? current.envelope.streams.map((s) => (s === prior ? row : s))
          : [...current.envelope.streams, row];
        const next = captureAuthorityEnvelope(
          JSON.stringify({
            version: 1,
            lineage,
            schema,
            revision,
            state: state.value,
            streams,
          }),
          validate,
        );
        if (!live()) return result({ status: 'retired' });
        const permittedNow = authorize(context);
        if (!live()) return result({ status: 'retired' });
        if (permittedNow !== true)
          return result({ status: 'refused', reason: 'unauthorized' });
        // Last admission point: nothing awaits between this check and invocation.
        const late = lapsed();
        if (!live()) return result({ status: 'retired' });
        if (late) return late;
        invoked = true;
        const outcome = await compareAndSwap(
          Object.freeze({
            lineage,
            schema,
            revision: current.envelope.revision,
            json: next.json,
          }),
        );
        if (!live()) return result({ status: 'retired' });
        if (outcome === 'rejected') return unavailable('storage-conflict');
        if (outcome !== 'committed')
          return unavailable('commit-unknown', 'unknown');
        current = next;
        floor = revision;
        status = 'ready';
        return result({
          status: 'committed',
          revision,
          sequence,
          result: output.value,
        });
      } catch {
        if (!live()) return result({ status: 'retired' });
        if (invoked) return unavailable('commit-unknown', 'unknown');
        return result({ status: 'refused', reason: 'invalid' });
      } finally {
        busy = false;
        if (!retired && status === 'pending') status = 'ready';
      }
    },
    dispose() {
      if (retired) return;
      retired = true;
      status = 'retired';
      reason = 'disposed';
      current = null;
    },
  });
}
