import test from 'node:test';
import assert from 'node:assert/strict';
import {captureDiagnosticSubjects, DIAGNOSTIC_SUBJECT_LIMITS} from './diagnostic-subjects.mjs';

const target = () => ({ownerId: 'visit', epoch: '4', kind: 'entity', id: '1'});
const fixture = () => ({
  captureId: 'run', before: {available: true, token: 'accepted-4'}, after: {available: true, token: 'accepted-4'},
  digests: {build: {provenance: 'unavailable', value: null}, configuration: {provenance: 'declared', value: 'sha256:config'}},
  records: [{target: target(), provenance: 'observed', artifact: 'entities.json#1', completeness: {status: 'partial', counters: [{name: 'omittedComponents', value: 2}]}}],
  associations: [{subject: {namespace: 'demo', subjectId: 'subject', revision: 'r3'}, source: null,
    relationship: 'represents', provenance: 'declared', targets: [target()]}],
});
const rejection = (input, code, path, limits) => assert.deepEqual(captureDiagnosticSubjects(input, limits), {ok: false, error: {code, path}});

test('exact independent output retains partial producer evidence and classifications', () => {
  assert.deepEqual(captureDiagnosticSubjects(fixture()), {ok: true, sidecar: {
    schema: 'diagnostic-subjects/1', captureId: 'run', token: 'accepted-4',
    digests: {build: {provenance: 'unavailable', value: null}, configuration: {provenance: 'declared', value: 'sha256:config'}},
    records: [{target: {ownerId: 'visit', epoch: '4', kind: 'entity', id: '1'}, provenance: 'observed', artifact: 'entities.json#1', completeness: {status: 'partial', counters: [{name: 'omittedComponents', value: 2}]}}],
    associations: [{subject: {namespace: 'demo', subjectId: 'subject', revision: 'r3'}, source: null, relationship: 'represents', provenance: 'declared', targets: [{ownerId: 'visit', epoch: '4', kind: 'entity', id: '1'}]}],
  }});
});

test('nested mutation in either direction cannot affect input, historical output or a later call', () => {
  const input = fixture();
  const first = captureDiagnosticSubjects(input).sidecar;
  const historical = JSON.stringify(first);
  input.associations[0].subject.revision = 'r4';
  input.records[0].completeness.counters[0].value = 10;
  assert.equal(JSON.stringify(first), historical);
  const second = captureDiagnosticSubjects(input).sidecar;
  first.associations[0].targets[0].id = 'mutated';
  first.records[0].target.ownerId = 'other';
  first.digests.configuration.value = 'changed';
  assert.equal(second.associations[0].subject.revision, 'r4');
  assert.equal(second.associations[0].targets[0].id, '1');
  assert.equal(input.records[0].target.ownerId, 'visit');
  assert.equal(input.digests.configuration.value, 'sha256:config');
});

test('capture lifetime and accepted revision failures are atomic and recoverable', () => {
  const input = fixture();
  input.after.token = 'next';
  rejection(input, 'stale', 'capture.after');
  input.after.available = false;
  rejection(input, 'unavailable', 'capture.after');
  input.before.available = false;
  rejection(input, 'unavailable', 'capture.before');
  assert.equal(captureDiagnosticSubjects(fixture()).ok, true);
});

test('all identity fields reject oversize UTF-8 without truncation; exact boundary accepted', () => {
  const setters = [
    [x => x, 'captureId', 'capture.captureId'],
    [x => x.before, 'token', 'capture.before.token'],
    ...['namespace', 'subjectId', 'revision'].map(k => [x => x.associations[0].subject, k, `capture.associations[0].subject.${k}`]),
    ...['ownerId', 'epoch', 'kind', 'id'].map(k => [x => x.records[0].target, k, `capture.records[0].target.${k}`]),
  ];
  for (const [get, key, path] of setters) {
    const x = fixture(); get(x)[key] = 'é'.repeat(129);
    rejection(x, 'overlimit', path);
  }
  const x = fixture(); x.associations[0].subject.subjectId = 'é'.repeat(128);
  assert.equal(captureDiagnosticSubjects(x).sidecar.associations[0].subject.subjectId, 'é'.repeat(128));
  x.associations[0].subject.subjectId = '\ud800';
  rejection(x, 'invalid', 'capture.associations[0].subject.subjectId');
});

test('collection and encoded byte limits reject the whole batch', () => {
  for (const [name, path, mutate] of [
    ['associations', 'capture.associations', x => x.associations.push(x.associations[0])],
    ['records', 'capture.records', x => x.records.push(x.records[0])],
    ['references', 'capture.associations[0].targets', x => x.associations[0].targets.push(target())],
    ['counters', 'capture.records[0].completeness.counters', x => x.records[0].completeness.counters.push({name: 'dropped', value: 1})],
  ]) {
    const x = fixture(); mutate(x); rejection(x, 'overlimit', path, {[name]: 1});
  }
  const bytes = Buffer.byteLength(JSON.stringify(captureDiagnosticSubjects(fixture()).sidecar));
  assert.equal(captureDiagnosticSubjects(fixture(), {outputBytes: bytes}).ok, true);
  rejection(fixture(), 'overlimit', 'sidecar', {outputBytes: bytes - 1});
  const x = fixture(); x.records.length = 1e9;
  rejection(x, 'overlimit', 'capture.records');
});

test('limits cannot be disabled or raised above hard ceilings', () => {
  for (const [key, value] of Object.entries(DIAGNOSTIC_SUBJECT_LIMITS)) {
    for (const bad of [0, -1, NaN, Infinity, 1.5, value + 1]) rejection(fixture(), 'invalid', `limits.${key}`, {[key]: bad});
  }
  rejection(fixture(), 'invalid', 'limits', {unknown: 1});
});

test('unknown records, duplicate scoped records and duplicate references are explicit', () => {
  const x = fixture(); x.associations[0].targets[0].epoch = '5';
  rejection(x, 'unavailable', 'capture.associations[0].targets[0]');
  const y = fixture(); y.records.push(y.records[0]);
  rejection(y, 'duplicate', 'capture.records[1].target');
  const z = fixture(); z.associations[0].targets.push(target());
  rejection(z, 'duplicate', 'capture.associations[0].targets[1]');
});

test('getters and arbitrary payloads are rejected without executing application callbacks', () => {
  let calls = 0;
  const x = fixture(); Object.defineProperty(x.associations[0].subject, 'revision', {get() {calls++; throw Error();}});
  rejection(x, 'invalid', 'capture.associations[0].subject');
  const y = fixture(); Object.defineProperty(y.records, '0', {get() {calls++; return {};}});
  rejection(y, 'invalid', 'capture.records');
  const z = fixture(); z.associations[0].payload = z;
  rejection(z, 'invalid', 'capture.associations[0]');
  assert.equal(calls, 0);
  rejection(new Proxy({}, {getPrototypeOf() {throw null;}}), 'unavailable', 'capture');
  const opaque = new Proxy({}, {getPrototypeOf() {throw null;}});
  rejection(new Proxy({}, {getPrototypeOf() {throw opaque;}}), 'unavailable', 'capture');
  const sparse = fixture(); delete sparse.records[0];
  rejection(sparse, 'invalid', 'capture.records');
});

test('missing and false digest evidence is rejected, unavailable must be explicit', () => {
  const x = fixture(); delete x.digests.build;
  rejection(x, 'invalid', 'capture.digests.build');
  x.digests.build = {provenance: 'unavailable', value: 'pretend'};
  rejection(x, 'invalid', 'capture.digests.build.value');
  x.digests.build = {provenance: 'verified', value: 'pretend'};
  rejection(x, 'invalid', 'capture.digests.build.provenance');
});

test('scope tuples remain distinct when identities contain separators', () => {
  const x = fixture();
  x.records[0].target = {ownerId: 'a/b', epoch: 'c', kind: 'entity', id: '1'};
  x.records.push({...x.records[0], target: {ownerId: 'a', epoch: 'b/c', kind: 'entity', id: '1'}});
  x.associations[0].targets = x.records.map(r => r.target);
  const result = captureDiagnosticSubjects(x);
  assert.equal(result.ok, true);
  assert.deepEqual(result.sidecar.associations[0].targets, [
    {ownerId: 'a/b', epoch: 'c', kind: 'entity', id: '1'},
    {ownerId: 'a', epoch: 'b/c', kind: 'entity', id: '1'},
  ]);
});

test('source locators and digests are bounded and detached through serialization', () => {
  const x = fixture();
  x.associations[0].source = {path: 'source.json', selector: '/parts/0', digest: {provenance: 'declared', value: 'sha256:abc'}};
  const result = captureDiagnosticSubjects(x).sidecar;
  x.associations[0].source.digest.value = 'changed';
  result.associations[0].source.path = 'elsewhere';
  assert.equal(x.associations[0].source.path, 'source.json');
  assert.deepEqual(JSON.parse(JSON.stringify(result)).associations[0].source, {
    path: 'elsewhere', selector: '/parts/0', digest: {provenance: 'declared', value: 'sha256:abc'},
  });
  for (const key of ['path', 'selector']) {
    const y = structuredClone(x); y.associations[0].source[key] = 'x'.repeat(2049);
    rejection(y, 'overlimit', `capture.associations[0].source.${key}`);
  }
  x.associations[0].source.digest.value = 'x'.repeat(257);
  rejection(x, 'overlimit', 'capture.associations[0].source.digest.value');
});
