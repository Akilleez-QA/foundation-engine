/** Optional report-side association only. No runtime imports or retained state. */
export const DIAGNOSTIC_SUBJECT_LIMITS = Object.freeze({
  associations: 128, records: 512, references: 32, counters: 16,
  identityBytes: 256, textBytes: 2048, outputBytes: 262144,
});

const classifications = ['declared', 'observed', 'estimated', 'derived', 'consumer-reported', 'unavailable'];
class Invalid extends Error {
  constructor(code, path) { super(code); this.code = code; this.path = path; }
}
const fail = (code, path) => { throw new Invalid(code, path); };

/**
 * Accept plain data snapshots, not adapters or arbitrary generic payloads.
 * Returns {ok:true, sidecar} or {ok:false, error:{code,path}} atomically.
 */
export function captureDiagnosticSubjects(input, limits = {}) {
  try {
    const object = (value, fields, path) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid', path);
      const keys = Reflect.ownKeys(value);
      if (keys.length > fields.length) fail('invalid', path);
      const copy = Object.create(null);
      for (const key of keys) {
        if (!fields.includes(key)) fail('invalid', path);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor)) fail('invalid', path);
        copy[key] = descriptor.value;
      }
      return copy;
    };
    const settings = object(limits, Object.keys(DIAGNOSTIC_SUBJECT_LIMITS), 'limits');
    const cap = {...DIAGNOSTIC_SUBJECT_LIMITS};
    for (const key of Object.keys(settings)) {
      const value = settings[key];
      if (!Number.isSafeInteger(value) || value < 1 || value > cap[key]) fail('invalid', `limits.${key}`);
      cap[key] = value;
    }
    const string = (value, path, max = cap.identityBytes) => {
      if (typeof value !== 'string' || value.length === 0) fail('invalid', path);
      if (value.length > max || Buffer.byteLength(value, 'utf8') > max) fail('overlimit', path);
      // Reject malformed Unicode: JSON round trips must retain usable exact identities.
      if (!value.isWellFormed()) fail('invalid', path);
      return value;
    };
    const choice = (value, values, path) => {
      if (!values.includes(value)) fail('invalid', path);
      return value;
    };
    const array = (value, max, path, parse) => {
      if (!Array.isArray(value)) fail('invalid', path);
      const length = Object.getOwnPropertyDescriptor(value, 'length').value;
      if (length > max) fail('overlimit', path);
      const result = [];
      for (let i = 0; i < length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !('value' in descriptor)) fail('invalid', path);
        result.push(parse(descriptor.value, `${path}[${i}]`));
      }
      return result;
    };
    const digest = (value, path) => {
      const d = object(value, ['provenance', 'value'], path);
      const provenance = choice(d.provenance, ['declared', 'observed', 'unavailable'], `${path}.provenance`);
      if (provenance === 'unavailable') {
        if (d.value !== null) fail('invalid', `${path}.value`);
        return {provenance, value: null};
      }
      return {provenance, value: string(d.value, `${path}.value`)};
    };
    const scope = (value, path) => {
      const s = object(value, ['ownerId', 'epoch', 'kind', 'id'], path);
      return Object.fromEntries(['ownerId', 'epoch', 'kind', 'id'].map(key => [key, string(s[key], `${path}.${key}`)]));
    };
    const keyOf = s => JSON.stringify([s.ownerId, s.epoch, s.kind, s.id]);
    const stamp = (value, path) => {
      const s = object(value, ['available', 'token'], path);
      if (typeof s.available !== 'boolean') fail('invalid', `${path}.available`);
      if (!s.available) fail('unavailable', path);
      return string(s.token, `${path}.token`);
    };
    const root = object(input, ['captureId', 'before', 'after', 'digests', 'records', 'associations'], 'capture');
    const captureId = string(root.captureId, 'capture.captureId');
    const before = stamp(root.before, 'capture.before');
    const after = stamp(root.after, 'capture.after');
    if (before !== after) fail('stale', 'capture.after');
    const fingerprints = object(root.digests, ['build', 'configuration'], 'capture.digests');
    const digests = {
      build: digest(fingerprints.build, 'capture.digests.build'),
      configuration: digest(fingerprints.configuration, 'capture.digests.configuration'),
    };
    const known = new Set();
    const records = array(root.records, cap.records, 'capture.records', (value, path) => {
      const r = object(value, ['target', 'provenance', 'artifact', 'completeness'], path);
      const target = scope(r.target, `${path}.target`);
      const key = keyOf(target);
      if (known.has(key)) fail('duplicate', `${path}.target`);
      known.add(key);
      const c = object(r.completeness, ['status', 'counters'], `${path}.completeness`);
      const names = new Set();
      const counters = array(c.counters, cap.counters, `${path}.completeness.counters`, (value, path) => {
        const counter = object(value, ['name', 'value'], path);
        const name = string(counter.name, `${path}.name`);
        if (names.has(name)) fail('duplicate', `${path}.name`);
        names.add(name);
        if (!Number.isSafeInteger(counter.value) || counter.value < 0) fail('invalid', `${path}.value`);
        return {name, value: counter.value};
      });
      return {
        target, provenance: choice(r.provenance, classifications, `${path}.provenance`),
        artifact: string(r.artifact, `${path}.artifact`, cap.textBytes),
        completeness: {status: choice(c.status, ['complete', 'partial', 'unavailable'], `${path}.completeness.status`), counters},
      };
    });
    const associations = array(root.associations, cap.associations, 'capture.associations', (value, path) => {
      const a = object(value, ['subject', 'source', 'relationship', 'provenance', 'targets'], path);
      const s = object(a.subject, ['namespace', 'subjectId', 'revision'], `${path}.subject`);
      const subject = Object.fromEntries(['namespace', 'subjectId', 'revision'].map(key => [key, string(s[key], `${path}.subject.${key}`)]));
      let source = null;
      if (a.source !== null) {
        const src = object(a.source, ['path', 'selector', 'digest'], `${path}.source`);
        source = {path: string(src.path, `${path}.source.path`, cap.textBytes),
          selector: string(src.selector, `${path}.source.selector`, cap.textBytes),
          digest: digest(src.digest, `${path}.source.digest`)};
      }
      const seen = new Set();
      const targets = array(a.targets, cap.references, `${path}.targets`, (value, path) => {
        const target = scope(value, path);
        const key = keyOf(target);
        if (!known.has(key)) fail('unavailable', path);
        if (seen.has(key)) fail('duplicate', path);
        seen.add(key);
        return target;
      });
      if (!targets.length) fail('invalid', `${path}.targets`);
      return {subject, source, relationship: string(a.relationship, `${path}.relationship`),
        provenance: choice(a.provenance, classifications, `${path}.provenance`), targets};
    });
    const sidecar = {schema: 'diagnostic-subjects/1', captureId, token: before, digests, records, associations};
    if (Buffer.byteLength(JSON.stringify(sidecar), 'utf8') > cap.outputBytes) fail('overlimit', 'sidecar');
    return {ok: true, sidecar};
  } catch (error) {
    // Do not stringify arbitrary thrown objects or retain caller references.
    try {
      if (error instanceof Invalid) return {ok: false, error: {code: error.code, path: error.path}};
    } catch { /* A thrown proxy may itself reject inspection. */ }
    return {ok: false, error: {code: 'unavailable', path: 'capture'}};
  }
}
