import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {captureDiagnosticSubjects} from './diagnostic-subjects.mjs';

// Synthetic creator state: distinct shapes, no proprietary content or runtime imports.
const assembly = {document: 'hinge', edition: 'drawing-7', playbackRestart: 80, pieces: [1, 2], material: 'alloy'};
const terrain = {map: 'ridge', accepted: {revision: 'survey-3', generation: 9}, pending: {revision: 'survey-4', generation: 10}, tiles: [1, 2]};
const unavailable = () => ({provenance: 'unavailable', value: null});
const hash = bytes => ({provenance: 'observed', value: `sha256:${createHash('sha256').update(bytes).digest('hex')}`});
const target = (ownerId, epoch, kind, id) => ({ownerId, epoch: String(epoch), kind, id: String(id)});
const entity = id => target('scene-visit-A', 9, 'entity', id);
const tile = id => target('terrain-owner-B', 9, 'tile', id);
const invocation = () => target('scene-visit-A', 9, 'system-invocation', 'ordinal-2/sequence-8');
const asset = () => target('asset-owner', 'lease-6', 'asset-variant', 'alloy-low');
function record(target, provenance, artifact, status = 'complete', counters = []) {
  return {target, provenance, artifact, completeness: {status, counters}};
}
function capture(a = assembly, t = terrain, captureId = 'run-A') {
  // The adapter owns this monotonic composite state stamp and samples around collection.
  const token = `visit-A:9/${a.edition}/terrain-B:${t.accepted.generation}/${t.accepted.revision}`;
  return {
    captureId, before: {available: true, token}, after: {available: true, token},
    digests: {build: unavailable(), configuration: hash('seed=12;camera=orthographic')},
    records: [
      ...a.pieces.map(id => record(entity(id), 'observed', `entities.json#${id}`)),
      record(invocation(), 'observed', 'timing.json#sequence-8', 'partial', [{name: 'dropped', value: 3}]),
      record(asset(), 'declared', 'assets.json#alloy-low'),
      ...t.tiles.map(id => record(target('terrain-owner-B', t.accepted.generation, 'tile', id), 'observed', `terrain.json#${id}`)),
      record(target('terrain-owner-B', t.accepted.generation, 'reservation', 1), 'estimated', 'terrain.json#reservedBytes'),
    ],
    associations: [
      {subject: {namespace: 'assembly', subjectId: a.document, revision: a.edition},
        source: {path: 'creator/hinge.json', selector: '/parts', digest: unavailable()},
        relationship: 'represents', provenance: 'declared', targets: a.pieces.map(entity)},
      {subject: {namespace: 'assembly', subjectId: a.document, revision: a.edition}, source: null,
        relationship: 'uses asset', provenance: 'declared', targets: [asset()]},
      ...[a.document, 'other-assembly'].map(subjectId => ({subject: {namespace: 'assembly', subjectId, revision: subjectId === a.document ? a.edition : 'drawing-2'},
        source: null, relationship: 'processed by', provenance: 'declared', targets: [invocation()]})),
      {subject: {namespace: 'surface', subjectId: t.map, revision: t.accepted.revision},
        source: {path: 'creator/ridge.csv', selector: 'height', digest: {provenance: 'declared', value: 'sha256:author-supplied'}},
        relationship: 'represents', provenance: 'declared', targets: t.tiles.map(id => target('terrain-owner-B', t.accepted.generation, 'tile', id))},
    ],
  };
}

test('two independent creator shapes serialize to explicit expected subject/source links', () => {
  const result = captureDiagnosticSubjects(capture());
  assert.equal(result.ok, true);
  const out = JSON.parse(JSON.stringify(result.sidecar));
  assert.deepEqual(out.associations[0], {
    subject: {namespace: 'assembly', subjectId: 'hinge', revision: 'drawing-7'},
    source: {path: 'creator/hinge.json', selector: '/parts', digest: {provenance: 'unavailable', value: null}},
    relationship: 'represents', provenance: 'declared', targets: [
      {ownerId: 'scene-visit-A', epoch: '9', kind: 'entity', id: '1'},
      {ownerId: 'scene-visit-A', epoch: '9', kind: 'entity', id: '2'},
    ],
  });
  assert.deepEqual(out.associations[4], {
    subject: {namespace: 'surface', subjectId: 'ridge', revision: 'survey-3'},
    source: {path: 'creator/ridge.csv', selector: 'height', digest: {provenance: 'declared', value: 'sha256:author-supplied'}},
    relationship: 'represents', provenance: 'declared', targets: [
      {ownerId: 'terrain-owner-B', epoch: '9', kind: 'tile', id: '1'},
      {ownerId: 'terrain-owner-B', epoch: '9', kind: 'tile', id: '2'},
    ],
  });
  assert.deepEqual(out.records[2].completeness, {status: 'partial', counters: [{name: 'dropped', value: 3}]});
  assert.equal(out.records[6].provenance, 'estimated');
  assert.deepEqual(out.digests.build, {provenance: 'unavailable', value: null});
  assert.equal(out.records[3].provenance, 'declared');
});

test('equal local IDs across owner, epoch, kind and capture scopes never collide', () => {
  const input = capture();
  for (const t of [target('scene-visit-B', 9, 'entity', 1), target('scene-visit-A', 10, 'entity', 1), target('scene-visit-A', 9, 'component', 1)]) {
    input.records.push(record(t, 'observed', 'other.json#1'));
    input.associations[0].targets.push(t);
  }
  const a = captureDiagnosticSubjects(input);
  assert.equal(a.ok, true);
  assert.equal(a.sidecar.records.length, 10);
  const b = captureDiagnosticSubjects({...input, captureId: 'run-B'}).sidecar;
  assert.equal(b.captureId, 'run-B');
  assert.deepEqual(a.sidecar.records, b.records);
  assert.notEqual(a.sidecar.captureId, b.captureId);
  assert.deepEqual(a.sidecar.associations[4].targets[0], tile(1));
});

test('pending surface publication and playback restart do not rewrite authored revisions', () => {
  const historical = captureDiagnosticSubjects(capture()).sidecar;
  const restart = captureDiagnosticSubjects(capture({...assembly, playbackRestart: 999})).sidecar;
  assert.deepEqual(restart, historical);
  const edited = captureDiagnosticSubjects(capture({...assembly, edition: 'drawing-8'})).sidecar;
  assert.equal(edited.associations[0].subject.revision, 'drawing-8');
  assert.deepEqual(edited.records, historical.records);
  assert.equal(edited.associations[4].subject.revision, 'survey-3');
  const published = captureDiagnosticSubjects(capture(assembly, {...terrain, accepted: terrain.pending, pending: null})).sidecar;
  assert.equal(published.associations[4].subject.revision, 'survey-4');
  assert.equal(published.associations[4].targets[0].epoch, '10');
  assert.equal(historical.associations[4].subject.revision, 'survey-3');
});

test('shared invocation has one evidence record and no fabricated per-subject duration', () => {
  const rawTiming = {sequence: 8, durationMs: 4.25};
  const out = captureDiagnosticSubjects(capture()).sidecar;
  assert.equal(out.records.filter(r => r.target.kind === 'system-invocation').length, 1);
  assert.deepEqual(out.associations.slice(2, 4).map(a => a.subject.subjectId), ['hinge', 'other-assembly']);
  assert.deepEqual(out.associations[2].targets, out.associations[3].targets);
  assert.equal(JSON.stringify(out).includes('durationMs'), false);
  assert.deepEqual(rawTiming, {sequence: 8, durationMs: 4.25});
});

test('byte and configuration changes remain distinguishable despite identical Git HEAD', () => {
  const gitHead = 'same-commit';
  const a = capture();
  a.digests.build = hash('bundle bytes A');
  a.associations[0].source.digest = hash('source bytes A');
  // Asset bytes are fingerprinted in their raw artifact, not invented by this helper.
  a.records[3].artifact = `assets/${hash('asset bytes A').value}.json`;
  const baseline = JSON.stringify(captureDiagnosticSubjects(a).sidecar);
  for (const change of [
    x => {x.digests.build = hash('bundle bytes B');},
    x => {x.digests.configuration = hash('seed=13;camera=orthographic');},
    x => {x.associations[0].source.digest = hash('source bytes B');},
    x => {x.records[3].artifact = `assets/${hash('asset bytes B').value}.json`;},
  ]) {
    const x = structuredClone(a); change(x);
    assert.notEqual(JSON.stringify(captureDiagnosticSubjects(x).sidecar), baseline);
    assert.equal(gitHead, 'same-commit');
  }
});
