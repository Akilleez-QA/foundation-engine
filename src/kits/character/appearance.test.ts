import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthoringSession} from '../authoring/session';
import {createAppearanceDocument, type AppearanceValue} from './appearance';

const limits = {maxParts: 2, maxParameters: 2, maxBytes: 1024, maxNodes: 32, maxDepth: 4};
const json = (form = 'box', scale = 1, version = 1) => JSON.stringify({version, parts: {form}, parameters: {scale}});
const compatible = (value: AppearanceValue) => {
  const form = value.parts.form,
    scale = value.parameters.scale;
  return (
    form !== undefined &&
    scale !== undefined &&
    ['box', 'sphere'].includes(form) &&
    scale >= 0.5 &&
    scale <= (form === 'sphere' ? 1 : 2)
  );
};
const create = (saved = json(), validate = compatible) =>
  createAppearanceDocument({id: 'appearance', json: saved, version: 1, limits, validate});

test('appearance consumer: preview, rejection, cancellation, commit, undo and restore preserve accepted selections', () => {
  const document = create(),
    session = createAuthoringSession(document, {maxEntries: 3, maxHistoryBytes: 4096});
  const accepted = document.read();
  assert.equal(session.preview(accepted.ticket, () => json('sphere')).status, 'prepared');
  assert.equal(document.read(), accepted);
  assert.equal(session.readPreview()?.value.parts.form, 'sphere');
  // Rejection leaves an earlier valid draft intact; the accepted value never changes.
  assert.equal(session.preview(accepted.ticket, () => json('sphere', 2)).status, 'rejected');
  assert.equal(document.read(), accepted);
  assert.equal(session.cancel().status, 'cancelled');
  assert.equal(session.readPreview(), null);
  assert.equal(session.commit().status, 'empty');
  assert.equal(session.preview(accepted.ticket, () => json('sphere')).status, 'prepared');
  assert.equal(session.commit().status, 'accepted');
  const saved = document.read().json;
  assert.equal(session.undo().status, 'accepted');
  assert.equal(document.read().value.parts.form, 'box');
  assert.equal(session.redo().status, 'accepted');
  const restored = create(saved);
  assert.deepEqual(restored.read().value, document.read().value);
  assert.equal(restored.edit(document.read().ticket, () => json()).status, 'stale');
  session.dispose();
  document.dispose();
  restored.dispose();
});

test('appearance structural checks run before compatibility and reject unexpected shape and counts', () => {
  let calls = 0;
  const document = create(json(), () => {
    calls++;
    return true;
  });
  const before = document.read();
  const invalid = [
    null,
    [],
    {},
    {version: 1, parts: [], parameters: {}},
    {version: 1, parts: {}, parameters: {}, extra: true},
    {version: 1, parts: {a: 'x', b: 'y', c: 'z'}, parameters: {}},
    {version: 1, parts: {}, parameters: {a: 1, b: 2, c: 3}},
    {version: 1, parts: {a: ''}, parameters: {}},
    {version: 1, parts: {'': 'x'}, parameters: {}},
    {version: 1, parts: {}, parameters: {'': 1}},
    {version: 1, parts: {}, parameters: {a: '1'}},
    {version: 2, parts: {}, parameters: {}},
  ];
  for (const value of invalid)
    assert.equal(document.edit(before.ticket, () => JSON.stringify(value)).status, 'rejected');
  assert.equal(calls, 1);
  assert.equal(document.read(), before);
  assert.throws(
    () => document.edit(before.ticket, () => '{"version":1,"parts":{},"parameters":{"a":1e999}}'),
    /nonfinite/,
  );
  assert.throws(() => document.edit(before.ticket, () => ' '.repeat(1025)), /byte limit/);
  assert.equal(document.read(), before);
});

test('appearance configuration is captured and snapshots are deeply immutable', () => {
  const mutableLimits = {...limits};
  const options = {id: 'appearance', json: json(), version: 1, limits: mutableLimits, validate: compatible};
  const document = createAppearanceDocument(options);
  mutableLimits.maxParts = 0;
  options.version = 20;
  options.validate = () => false;
  assert.equal(document.edit(document.read().ticket, () => json('sphere')).status, 'accepted');
  assert.throws(() => {
    (document.read().value.parts as Record<string, string>).form = 'bad';
  }, TypeError);
  assert.throws(() => {
    (document.read().value.parameters as Record<string, number>).scale = 999;
  }, TypeError);
});

test('appearance creator validators retain busy, failure and retirement handling of the document owner', () => {
  let document: ReturnType<typeof create> | undefined;
  let mode = 'normal';
  document = create(json(), value => {
    assert.ok(Object.isFrozen(value.parts));
    if (mode === 'throw') throw Error('creator failure');
    if (mode === 'reenter') assert.equal(document!.edit(document!.read().ticket, () => json()).status, 'busy');
    if (mode === 'retire') document!.dispose();
    return true;
  });
  const initial = document.read();
  mode = 'throw';
  assert.throws(() => document!.edit(initial.ticket, () => json('sphere')), /creator failure/);
  assert.equal(document.read(), initial);
  mode = 'reenter';
  assert.equal(document.edit(initial.ticket, () => json('sphere')).status, 'accepted');
  const accepted = document.read();
  mode = 'retire';
  assert.equal(document.edit(accepted.ticket, () => json()).status, 'retired');
  assert.equal(document.read(), accepted);
});

test('appearance schema restoration is explicit and nonliteral validation cannot accept', () => {
  assert.throws(() => create(json('box', 1, 0)), /rejected initial/);
  const migrated = JSON.stringify({...JSON.parse(json('box', 1, 0)), version: 1});
  assert.equal(create(migrated).read().value.version, 1);
  assert.throws(
    () => create(json(), (() => Promise.resolve(true)) as unknown as typeof compatible),
    /rejected initial/,
  );
  for (const maxParts of [-1, 1.5, Infinity])
    assert.throws(
      () =>
        createAppearanceDocument({
          id: 'appearance',
          json: json(),
          version: 1,
          limits: {...limits, maxParts},
          validate: compatible,
        }),
      /invalid configuration/,
    );
  const empty = createAppearanceDocument({
    id: 'empty',
    json: '{"version":0,"parts":{},"parameters":{}}',
    version: 0,
    limits: {...limits, maxParts: 0, maxParameters: 0},
    validate: () => true,
  });
  assert.deepEqual(empty.read().value.parts, {});
});

test('appearance preview retirement discards candidates and external edits invalidate session tickets', () => {
  const document = create(),
    session = createAuthoringSession(document, {maxEntries: 1, maxHistoryBytes: 2048});
  session.preview(document.read().ticket, () => json('sphere'));
  const candidate = session.readPreview()!;
  session.dispose();
  assert.equal(document.publish(candidate).status, 'stale');
  const other = createAuthoringSession(document, {maxEntries: 1, maxHistoryBytes: 2048});
  other.preview(document.read().ticket, () => json('sphere'));
  document.edit(document.read().ticket, () => json('box', 2));
  assert.equal(other.readPreview(), null);
  assert.equal(other.commit().status, 'stale');
  assert.equal(other.resetHistory().status, 'reset');
  assert.equal(other.preview(document.read().ticket, () => json('sphere')).status, 'prepared');
  assert.equal(other.commit().status, 'accepted');
});

test('appearance history saturation keeps both accepted data and the inspectable draft', () => {
  const document = create(),
    before = document.read();
  const session = createAuthoringSession(document, {maxEntries: 1, maxHistoryBytes: 1});
  assert.equal(session.preview(before.ticket, () => json('sphere')).status, 'prepared');
  const candidate = session.readPreview();
  assert.equal(session.commit().status, 'saturated');
  assert.equal(document.read(), before);
  assert.equal(session.readPreview(), candidate);
  assert.equal(session.cancel().status, 'cancelled');
  assert.equal(session.readPreview(), null);
});
