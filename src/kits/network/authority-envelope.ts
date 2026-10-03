import type {DocumentValue} from '../authoring/document';
import {captureJson, captureJsonLimits} from './captured-json';
import type {AuthorityEnvelope, AuthorityLimits, AuthoritySnapshot, AuthorityValidation} from './authority-types';

const record = (v: DocumentValue): v is {readonly [key: string]: DocumentValue} =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: DocumentValue, fields: readonly string[]) =>
  record(v) && Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v, k));
export const authorityInteger = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
export const authorityIdentity = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 256;
export function captureAuthorityLimits(input: AuthorityLimits): AuthorityLimits {
  const envelope = captureJsonLimits(input.envelope),
    state = captureJsonLimits(input.state),
    command = captureJsonLimits(input.input),
    result = captureJsonLimits(input.result);
  const maxStreams = input.maxStreams,
    maxReceiptsPerStream = input.maxReceiptsPerStream;
  if (![maxStreams, maxReceiptsPerStream].every(n => authorityInteger(n) && n > 0))
    throw Error('authority: invalid capacity');
  return Object.freeze({
    envelope,
    state,
    input: command,
    result,
    maxStreams,
    maxReceiptsPerStream,
  });
}
export function captureAuthorityEnvelope(json: string, options: AuthorityValidation): AuthoritySnapshot {
  const captured = captureJson(json, options.limits.envelope),
    value = captured.value;
  if (
    !exact(value, ['version', 'lineage', 'schema', 'revision', 'state', 'streams']) ||
    !record(value) ||
    value.version !== 1 ||
    value.lineage !== options.lineage ||
    value.schema !== options.schema ||
    !authorityInteger(value.revision) ||
    !Array.isArray(value.streams) ||
    value.streams.length > options.limits.maxStreams
  )
    throw Error('authority: envelope');
  captureJson(JSON.stringify(value.state), options.limits.state, options.validateState);
  const events: {revision: number; omittedPrefix: number}[] = [];
  const ids = new Set<string>(),
    revisions = new Set<number>();
  let remaining = value.revision,
    latest = 0;
  for (const stream of value.streams) {
    if (
      !exact(stream, ['id', 'through', 'receipts']) ||
      !record(stream) ||
      !authorityIdentity(stream.id) ||
      ids.has(stream.id) ||
      !authorityInteger(stream.through) ||
      stream.through > remaining ||
      !Array.isArray(stream.receipts) ||
      stream.receipts.length !== Math.min(stream.through, options.limits.maxReceiptsPerStream)
    )
      throw Error('authority: stream');
    ids.add(stream.id);
    remaining -= stream.through;
    let previous = 0;
    for (let i = 0; i < stream.receipts.length; i++) {
      const receipt = stream.receipts[i],
        sequence = stream.through - stream.receipts.length + i + 1;
      if (
        !exact(receipt, ['sequence', 'revision', 'input', 'result']) ||
        !record(receipt) ||
        receipt.sequence !== sequence ||
        !authorityInteger(receipt.revision) ||
        receipt.revision < sequence ||
        receipt.revision <= previous ||
        receipt.revision > value.revision ||
        revisions.has(receipt.revision)
      )
        throw Error('authority: receipt');
      captureJson(JSON.stringify(receipt.input), options.limits.input, options.validateInput);
      captureJson(JSON.stringify(receipt.result), options.limits.result, options.validateResult);
      previous = receipt.revision;
      latest = Math.max(latest, previous);
      revisions.add(previous);
      events.push({revision: previous, omittedPrefix: i === 0 ? sequence - 1 : 0});
    }
  }
  if (remaining !== 0 || latest !== value.revision) throw Error('authority: revision coherence');
  // The only unknown commands precede each stream's contiguous retained suffix.
  // Fixed retained revisions consume slots; omitted prefixes must fit in the free
  // slots before their first retained receipt (earliest-deadline feasibility).
  // This validates possible metadata interleaving, not evicted payload authenticity.
  events.sort((a, b) => a.revision - b.revision);
  let omitted = 0;
  for (const [i, event] of events.entries()) {
    const available = event.revision - 1 - i;
    if (event.omittedPrefix > available - omitted) throw Error('authority: impossible receipt chronology');
    omitted += event.omittedPrefix;
  }
  return Object.freeze({
    // lint:allow-unknown-cast every field was validated above; AuthorityEnvelope has no DocumentValue index signature
    envelope: value as unknown as AuthorityEnvelope,
    json: captured.json,
    bytes: captured.bytes,
  });
}
/** Operator initialization only: never called by recover() for missing or corrupt storage. */
export function createAuthorityGenesis(
  options: Omit<AuthorityValidation, 'validateInput' | 'validateResult'> & {
    readonly stateJson: string;
  },
): string {
  const lineage = options.lineage,
    schema = options.schema,
    limits = captureAuthorityLimits(options.limits),
    validateState = options.validateState;
  if (!authorityIdentity(lineage) || !authorityIdentity(schema)) throw Error('authority: identity');
  const state = captureJson(options.stateJson, limits.state, validateState);
  return captureAuthorityEnvelope(
    JSON.stringify({
      version: 1,
      lineage,
      schema,
      revision: 0,
      state: state.value,
      streams: [],
    }),
    {
      lineage,
      schema,
      limits,
      validateState,
      validateInput: () => true,
      validateResult: () => true,
    },
  ).json;
}
