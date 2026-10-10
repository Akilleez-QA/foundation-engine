/**
 * Optional acknowledged-baseline delta codec for complete scoped views.
 *
 * The publisher still projects and sends complete frames; the encoder sits between its `send` port and the
 * transport and may replace a complete frame with a smaller `view-delta` frame relative to the last frame the
 * receiving side acknowledged as adopted. The decoder sits between the transport and the receiver and rebuilds the
 * exact complete JSON the publisher produced, so the receiver's ordering, duplicate and conflict rules are unchanged.
 * The encoder proves each delta before sending it: if rebuilding does not reproduce the publisher's bytes exactly,
 * or the delta is not smaller, the complete frame is sent instead.
 */
import {createAuthoredDocument, type DocumentValue} from '../authoring/document';
import {captureViewFrame, captureViewLimits, viewIdentity} from './view-capture';
import type {ViewEntity, ViewFrame, ViewLimits} from './view-types';

export type ViewDeltaFrame = Readonly<{
  v: 1;
  type: 'view-delta';
  session: string;
  sequence: number;
  baseSequence: number;
  /** UTF-16 length of the base frame's complete JSON: a cheap fingerprint against a mismatched baseline. */
  baseLength: number;
  worldRevision: number;
  /** New entities and entities whose incarnation or fields changed, in their complete-frame order. */
  upserts: readonly ViewEntity[];
  /** IDs present in the baseline and absent from the complete frame. */
  removes: readonly string[];
  /** Present only when the complete order differs from the default merge (baseline order, then new IDs). */
  order?: readonly string[];
}>;

export type ViewDeltaEncoderState = Readonly<{
  state: 'active' | 'retired';
  /** Sequence of the acknowledged, adopted frame deltas are computed against, or null. */
  baseline: number | null;
  /** Sequence of the last encoded frame awaiting acknowledgment, or null. */
  pending: number | null;
  completeFrames: number;
  deltaFrames: number;
  /** UTF-16 code units the publisher produced and the encoder emitted (equal when nothing was replaced). */
  publishedLength: number;
  emittedLength: number;
}>;

export type ViewDeltaEncoder = Readonly<{
  /** Takes the publisher's frame JSON; returns the JSON to hand to the transport. Never throws for frame content. */
  encode(json: string): string;
  /**
   * Records the receiving side's acknowledgment of `sequence`. `adopted: false` (the receiver could not apply it
   * and invalidated) clears the baseline so the next frame is complete. Returns true only for the pending frame.
   */
  ack(session: string, sequence: number, adopted: boolean): boolean;
  /** Forces the next frame to be complete (for example after a disclosure change or a peer request). */
  requireComplete(): void;
  read(): ViewDeltaEncoderState;
  dispose(): void;
}>;

export type ViewDeltaDecodeResult = Readonly<
  | {status: 'complete' | 'reconstructed'; sequence: number; json: string}
  | {status: 'baseline-missing'; sequence: number}
  | {status: 'obsolete' | 'foreign' | 'invalid' | 'retired'}
>;

export type ViewDeltaDecoder = Readonly<{
  /** Turns wire JSON into complete frame JSON for `createViewReceiver().receive`. */
  decode(json: string): ViewDeltaDecodeResult;
  /** Call after the receiver accepted (and the consumer adopted) `sequence`; it becomes the delta baseline. */
  adopt(sequence: number): boolean;
  /** Drops the baseline (for example after `receiver.invalidate`); later deltas report `baseline-missing`. */
  invalidate(): void;
  read(): Readonly<{state: 'active' | 'retired'; baseline: number | null; pending: number | null}>;
  dispose(): void;
}>;

type Baseline = Readonly<{sequence: number; frame: ViewFrame | null; length: number; complete: boolean}>;
const DELTA_PREFIX = '{"v":1,"type":"view-delta",';

const entityJson = (e: ViewEntity) => JSON.stringify(e);

function completeJson(frame: ViewFrame): string {
  return JSON.stringify({
    v: 1,
    type: 'view',
    session: frame.session,
    sequence: frame.sequence,
    worldRevision: frame.worldRevision,
    entities: frame.entities,
  });
}

/** Rebuilds the complete frame, or null when the delta does not fit the baseline or the limits. */
function rebuild(base: ViewFrame, delta: ViewDeltaFrame, limits: ViewLimits): ViewFrame | null {
  const byId = new Map<string, ViewEntity>();
  for (const e of base.entities) byId.set(e.id, e);
  const removed = new Set<string>();
  for (const id of delta.removes) {
    if (!byId.has(id) || removed.has(id)) return null;
    removed.add(id);
    byId.delete(id);
  }
  const added: string[] = [];
  const upserted = new Set<string>();
  for (const e of delta.upserts) {
    if (removed.has(e.id) || upserted.has(e.id)) return null;
    upserted.add(e.id);
    if (!byId.has(e.id)) added.push(e.id);
    byId.set(e.id, e);
  }
  if (byId.size > limits.maxEntities) return null;
  let order: readonly string[];
  if (delta.order) {
    if (delta.order.length !== byId.size) return null;
    const seen = new Set<string>();
    for (const id of delta.order) {
      if (!byId.has(id) || seen.has(id)) return null;
      seen.add(id);
    }
    order = delta.order;
  } else {
    order = [...base.entities.map(e => e.id).filter(id => !removed.has(id)), ...added];
  }
  return Object.freeze({
    v: 1,
    type: 'view',
    session: delta.session,
    sequence: delta.sequence,
    worldRevision: delta.worldRevision,
    entities: Object.freeze(order.map(id => byId.get(id)!)), // every id in order was checked against byId above
  });
}

function record(value: DocumentValue): value is {readonly [key: string]: DocumentValue} {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function integer(value: DocumentValue | undefined, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}
function ids(value: DocumentValue | undefined, limits: ViewLimits): value is string[] {
  return Array.isArray(value) && value.length <= limits.maxEntities && value.every(id => viewIdentity(id, limits));
}
function exactKeys(value: {readonly [key: string]: DocumentValue}, required: string[], optional: string[] = []) {
  const actual = Object.keys(value);
  return (
    required.every(k => Object.hasOwn(value, k)) && actual.every(k => required.includes(k) || optional.includes(k))
  );
}
function validDelta(value: DocumentValue, limits: ViewLimits): boolean {
  if (!record(value) || value.v !== 1 || value.type !== 'view-delta') return false;
  if (
    !exactKeys(
      value,
      ['v', 'type', 'session', 'sequence', 'baseSequence', 'baseLength', 'worldRevision', 'upserts', 'removes'],
      ['order'],
    )
  )
    return false;
  if (!viewIdentity(value.session, limits) || !integer(value.sequence, 1) || !integer(value.baseSequence, 1))
    return false;
  if (value.baseSequence >= value.sequence || !integer(value.worldRevision) || !integer(value.baseLength, 1))
    return false;
  if (!ids(value.removes, limits) || (value.order !== undefined && !ids(value.order, limits))) return false;
  const upserts = value.upserts;
  if (!Array.isArray(upserts) || upserts.length > limits.maxEntities) return false;
  return upserts.every(
    e =>
      record(e) &&
      exactKeys(e, ['id', 'incarnation', 'fields']) &&
      viewIdentity(e.id, limits) &&
      integer(e.incarnation),
  );
}

/** Bounded capture of a delta frame under the same limits as a complete view. Throws when invalid. */
function captureDelta(json: string, limits: ViewLimits): ViewDeltaFrame {
  const document = createAuthoredDocument({
    id: 'network-view-delta',
    json,
    limits,
    validate: (value): value is DocumentValue => validDelta(value, limits),
  });
  const {value} = document.read();
  document.dispose();
  return value as unknown as ViewDeltaFrame; // lint:allow-unknown-cast validDelta checked the exact shape above
}

export function createViewDeltaEncoder(options: {session: string; limits: ViewLimits}): ViewDeltaEncoder {
  const limits = captureViewLimits(options.limits),
    session = options.session;
  if (!viewIdentity(session, limits)) throw Error('network view delta: invalid session');
  let retired = false,
    baseline: Baseline | null = null,
    pending: Baseline | null = null,
    forceComplete = false,
    completeFrames = 0,
    deltaFrames = 0,
    publishedLength = 0,
    emittedLength = 0;

  function emit(published: string, wire: string, delta: boolean) {
    publishedLength += published.length;
    emittedLength += wire.length;
    if (delta) deltaFrames++;
    else completeFrames++;
    return wire;
  }

  function tryDelta(base: ViewFrame, baseLength: number, next: ViewFrame, json: string): string | null {
    const before = new Map(base.entities.map(e => [e.id, entityJson(e)]));
    const present = new Set(next.entities.map(e => e.id));
    const upserts = next.entities.filter(e => before.get(e.id) !== entityJson(e));
    const removes = base.entities.map(e => e.id).filter(id => !present.has(id));
    const merged = [
      ...base.entities.map(e => e.id).filter(id => present.has(id)),
      ...next.entities.map(e => e.id).filter(id => !before.has(id)),
    ];
    const order = next.entities.map(e => e.id);
    const sameOrder = merged.length === order.length && merged.every((id, i) => id === order[i]);
    const delta: ViewDeltaFrame = {
      v: 1,
      type: 'view-delta',
      session,
      sequence: next.sequence,
      baseSequence: base.sequence,
      baseLength,
      worldRevision: next.worldRevision,
      upserts,
      removes,
      ...(sameOrder ? {} : {order}),
    };
    const wire = JSON.stringify(delta);
    if (wire.length >= json.length) return null;
    // Prove it: the decoder's own capture and rebuild must reproduce the publisher's exact bytes.
    const captured = captureDelta(wire, limits);
    const rebuilt = rebuild(base, captured, limits);
    return rebuilt && completeJson(rebuilt) === json ? wire : null;
  }

  return Object.freeze({
    encode(json: string) {
      if (retired) return json;
      let frame;
      try {
        frame = captureViewFrame(json, limits).value;
      } catch {
        return emit(json, json, false); // not ours to judge: the receiver will reject it
      }
      if (frame.session !== session) return emit(json, json, false);
      const complete = (): string => {
        pending = {
          sequence: frame.sequence,
          frame: frame.type === 'view' ? frame : null,
          length: json.length,
          complete: true,
        };
        return emit(json, json, false);
      };
      if (frame.type !== 'view' || forceComplete || !baseline?.frame || baseline.sequence >= frame.sequence)
        return complete();
      let wire: string | null = null;
      try {
        wire = tryDelta(baseline.frame, baseline.length, frame, json);
      } catch {
        wire = null;
      }
      if (wire === null) return complete();
      pending = {sequence: frame.sequence, frame, length: json.length, complete: false};
      return emit(json, wire, true);
    },
    ack(ackSession: string, sequence: number, adopted: boolean) {
      if (typeof adopted !== 'boolean') throw TypeError('network view delta: ack needs adopted true or false');
      if (retired || ackSession !== session || !pending || sequence !== pending.sequence) return false;
      baseline = adopted ? pending : null;
      // Only an adopted complete frame satisfies requireComplete; an earlier pending delta does not.
      if (adopted && pending.frame && pending.complete) forceComplete = false;
      pending = null;
      return true;
    },
    requireComplete() {
      baseline = null;
      forceComplete = true;
    },
    read() {
      return Object.freeze({
        state: retired ? ('retired' as const) : ('active' as const),
        baseline: baseline?.frame ? baseline.sequence : null,
        pending: pending ? pending.sequence : null,
        completeFrames,
        deltaFrames,
        publishedLength,
        emittedLength,
      });
    },
    dispose() {
      retired = true;
      baseline = null;
      pending = null;
    },
  });
}

export function createViewDeltaDecoder(options: {session: string; limits: ViewLimits}): ViewDeltaDecoder {
  const limits = captureViewLimits(options.limits),
    session = options.session;
  if (!viewIdentity(session, limits)) throw Error('network view delta: invalid session');
  let retired = false,
    baseline: Baseline | null = null,
    pending: Baseline | null = null,
    floor = 0;
  const done = <T extends ViewDeltaDecodeResult>(r: T): T => Object.freeze(r);

  return Object.freeze({
    decode(json: string): ViewDeltaDecodeResult {
      if (retired) return done({status: 'retired'});
      // The encoder always emits this exact prefix; anything else is judged as a complete frame.
      if (typeof json !== 'string') return done({status: 'invalid'});
      if (!json.startsWith(DELTA_PREFIX)) {
        let frame;
        try {
          frame = captureViewFrame(json, limits).value;
        } catch {
          return done({status: 'invalid'});
        }
        if (frame.session !== session) return done({status: 'foreign'});
        pending = {
          sequence: frame.sequence,
          frame: frame.type === 'view' ? frame : null,
          length: json.length,
          complete: true,
        };
        floor = Math.max(floor, frame.sequence);
        return done({status: 'complete', sequence: frame.sequence, json});
      }
      let delta: ViewDeltaFrame;
      try {
        delta = captureDelta(json, limits);
      } catch {
        return done({status: 'invalid'});
      }
      if (delta.session !== session) return done({status: 'foreign'});
      if (delta.sequence < floor || (baseline && delta.sequence <= baseline.sequence))
        return done({status: 'obsolete'});
      if (!baseline?.frame || baseline.sequence !== delta.baseSequence || baseline.length !== delta.baseLength)
        return done({status: 'baseline-missing', sequence: delta.sequence});
      const frame = rebuild(baseline.frame, delta, limits);
      if (!frame) return done({status: 'invalid'});
      const rebuilt = completeJson(frame);
      try {
        captureViewFrame(rebuilt, limits); // a rebuilt frame obeys the same limits as a complete one
      } catch {
        return done({status: 'invalid'});
      }
      pending = {sequence: frame.sequence, frame, length: rebuilt.length, complete: false};
      floor = Math.max(floor, frame.sequence);
      return done({status: 'reconstructed', sequence: frame.sequence, json: rebuilt});
    },
    adopt(sequence: number) {
      if (retired || !pending || pending.sequence !== sequence) return false;
      baseline = pending;
      pending = null;
      return true;
    },
    invalidate() {
      baseline = null;
      pending = null;
    },
    read() {
      return Object.freeze({
        state: retired ? ('retired' as const) : ('active' as const),
        baseline: baseline?.frame ? baseline.sequence : null,
        pending: pending ? pending.sequence : null,
      });
    },
    dispose() {
      retired = true;
      baseline = null;
      pending = null;
    },
  });
}
