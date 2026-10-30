import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthoredDocument, type DocumentValue, type PreparedDocument} from './document';
import {createAuthoringSession} from './session';
const limits = {maxBytes: 4096, maxNodes: 128, maxDepth: 8};
const history = {maxEntries: 16, maxHistoryBytes: 4096};
const numbers = () =>
  createAuthoredDocument({id: 'numbers', json: '0', limits, validate: (v): v is number => typeof v === 'number'});

test('staging changes no committed state and only exact fresh owner candidates publish', () => {
  const a = numbers(),
    b = numbers(),
    before = a.read();
  const prepared = a.prepare(before.ticket, () => '1');
  assert.equal(prepared.status, 'prepared');
  if (prepared.status !== 'prepared') throw Error('not prepared');
  assert.equal(a.read(), before);
  assert.equal(b.publish(prepared.candidate).status, 'stale');
  assert.equal(a.publish({...prepared.candidate}).status, 'stale');
  const hostile = new Proxy(
    {},
    {
      get() {
        throw Error('must not read');
      },
    },
  );
  assert.equal(a.publish(hostile as PreparedDocument<number>).status, 'stale');
  assert.equal(a.publish(prepared.candidate).status, 'accepted');
  assert.equal(a.read().ticket.revision, 1);
  assert.equal(a.publish(prepared.candidate).status, 'stale');
  assert.equal(b.edit(before.ticket, () => '2').status, 'stale');
  const next = a.prepare(a.read().ticket, () => '2');
  if (next.status !== 'prepared') throw Error('not prepared');
  a.dispose();
  assert.equal(a.publish(next.candidate).status, 'retired');
});

test('placement and dialogue share preview/cancel/history without a scene schema', () => {
  const cases: {
    initial: string;
    changed: string;
    validate(v: DocumentValue): boolean;
    project(v: DocumentValue): unknown;
    expected: unknown;
  }[] = [
    {
      initial: '{"objects":[{"id":"a","x":1},{"id":"b","x":2}]}',
      changed: '{"objects":[{"id":"a","x":4},{"id":"b","x":2}]}',
      validate: v => !!v && typeof v === 'object' && !Array.isArray(v) && 'objects' in v && Array.isArray(v.objects),
      project: v => (v as {objects: {id: string; x: number}[]}).objects.map(o => [o.id, o.x]),
      expected: [
        ['a', 4],
        ['b', 2],
      ],
    },
    {
      initial: '{"cards":[{"key":"hello","text":"Hello"}]}',
      changed: '{"cards":[{"key":"hello","text":"Welcome"}]}',
      validate: v => !!v && typeof v === 'object' && !Array.isArray(v) && 'cards' in v && Array.isArray(v.cards),
      project: v => (v as {cards: {text: string}[]}).cards.map(c => c.text),
      expected: ['Welcome'],
    },
  ];
  for (const fixture of cases) {
    const document = createAuthoredDocument({
      id: 'creator',
      json: fixture.initial,
      limits,
      validate: (v): v is DocumentValue => fixture.validate(v),
    });
    const session = createAuthoringSession(document, history),
      baseline = document.read();
    for (let i = 0; i < 3; i++) {
      assert.equal(session.preview(baseline.ticket, () => fixture.changed).status, 'prepared');
      assert.deepEqual(fixture.project(session.readPreview()!.value), fixture.expected);
      assert.equal(document.read(), baseline);
      assert.equal(session.cancel().status, 'cancelled');
      assert.equal(session.stats().entries, 0);
      assert.equal(session.stats().bytes, 0);
    }
    session.preview(baseline.ticket, () => fixture.changed);
    assert.equal(session.commit().status, 'accepted');
    assert.deepEqual(fixture.project(document.read().value), fixture.expected);
    assert.equal(document.read().ticket.revision, 1);
    assert.equal(session.undo().status, 'accepted');
    assert.equal(document.read().json, fixture.initial);
    assert.equal(session.redo().status, 'accepted');
    assert.equal(document.read().ticket.revision, 3);
    session.dispose();
    assert.equal(document.edit(document.read().ticket, () => fixture.initial).status, 'accepted');
  }
});

test('branching edits clear redo, monotonic revisions and independent count/byte eviction', () => {
  for (const options of [
    {maxEntries: 2, maxHistoryBytes: 100},
    {maxEntries: 20, maxHistoryBytes: 4},
  ]) {
    const document = numbers(),
      s = createAuthoringSession(document, options);
    const commit = (n: number) => {
      s.preview(document.read().ticket, () => String(n));
      assert.equal(s.commit().status, 'accepted');
    };
    commit(1);
    commit(2);
    assert.equal(s.undo().status, 'accepted');
    commit(3);
    assert.equal(s.redo().status, 'empty');
    assert.equal(document.read().ticket.revision, 4);
    commit(4);
    assert.equal(s.stats().entries, 2);
    assert.equal(s.stats().bytes, 4);
    s.undo();
    assert.equal(document.read().value, 3);
    s.undo();
    assert.equal(document.read().value, 1);
    assert.equal(s.undo().status, 'empty');
  }
  const document = numbers(),
    s = createAuthoringSession(document, {maxEntries: 1, maxHistoryBytes: 2});
  s.preview(document.read().ticket, () => '100');
  const before = document.read(),
    stats = s.stats();
  assert.equal(s.commit().status, 'saturated');
  assert.equal(document.read(), before);
  assert.deepEqual(s.stats(), stats);
});

test('failed undo preserves cursor and snapshot; failures keep the existing draft', () => {
  let mode = 'valid';
  const document = createAuthoredDocument({
    id: 'n',
    json: '0',
    limits,
    validate: (v): v is number => {
      if (mode === 'throw') throw Error('validation failed');
      return typeof v === 'number' && (mode !== 'reject-zero' || v !== 0);
    },
  });
  const s = createAuthoringSession(document, history);
  s.preview(document.read().ticket, () => '1');
  s.commit();
  s.preview(document.read().ticket, () => '2');
  const draft = s.readPreview(),
    before = document.read(),
    stats = s.stats();
  mode = 'reject-zero';
  assert.equal(s.undo().status, 'rejected');
  assert.equal(document.read(), before);
  assert.deepEqual(s.stats(), stats);
  assert.equal(s.readPreview(), draft);
  mode = 'throw';
  assert.throws(() => s.undo(), /validation failed/);
  assert.deepEqual(s.stats(), stats);
  assert.equal(document.read(), before);
  assert.throws(() => s.preview(before.ticket, () => '3'), /validation failed/);
  assert.equal(s.readPreview(), draft);
  mode = 'valid';
  assert.equal(s.undo().status, 'accepted');
  assert.equal(s.stats().cursor, 0);
});

test('external edits conflict with preview commit and undo until explicit history reset', () => {
  const document = numbers(),
    s = createAuthoringSession(document, history);
  s.preview(document.read().ticket, () => '1');
  s.commit();
  s.preview(document.read().ticket, () => '2');
  document.edit(document.read().ticket, () => '3');
  const external = document.read();
  assert.equal(s.commit().status, 'stale');
  assert.equal(s.undo().status, 'stale');
  assert.equal(s.readPreview(), null);
  assert.equal(document.read(), external);
  assert.equal(s.resetHistory().status, 'reset');
  assert.equal(s.stats().entries, 0);
  assert.equal(s.stats().pending, false);
  assert.equal(s.undo().status, 'empty');
  s.preview(external.ticket, () => '4');
  assert.equal(s.commit().status, 'accepted');
  s.undo();
  assert.equal(document.read().value, 3);
});

test('reentrancy and disposal during proposals/validation never publish outer work', () => {
  for (const disposeDocument of [false, true]) {
    const document = numbers(),
      s = createAuthoringSession(document, history),
      before = document.read();
    assert.equal(
      s.preview(before.ticket, () => {
        assert.equal(s.commit().status, 'busy');
        assert.equal(s.cancel().status, 'busy');
        assert.equal(s.resetHistory().status, 'busy');
        assert.equal(s.undo().status, 'busy');
        assert.equal(s.preview(before.ticket, () => '9').status, 'busy');
        if (disposeDocument) document.dispose();
        else s.dispose();
        return '1';
      }).status,
      'retired',
    );
    assert.equal(document.read(), before);
    assert.equal(s.stats().pending, false);
  }
  let callback = () => {};
  const document = createAuthoredDocument({
    id: 'n',
    json: '0',
    limits,
    validate: (v): v is number => {
      callback();
      return typeof v === 'number';
    },
  });
  const s = createAuthoringSession(document, history);
  s.preview(document.read().ticket, () => '1');
  s.commit();
  const before = document.read();
  callback = () => s.dispose();
  assert.equal(s.undo().status, 'retired');
  assert.equal(document.read(), before);
  assert.equal(s.stats().bytes, 0);
  assert.equal(s.stats().entries, 0);
});
test('cancel, replacement, reset and disposal invalidate caller-retained preview candidates', () => {
  for (const action of ['cancel', 'replace', 'reset', 'dispose'] as const) {
    const document = numbers(),
      s = createAuthoringSession(document, history),
      before = document.read();
    const prepared = s.preview(before.ticket, () => '1');
    if (prepared.status !== 'prepared') throw Error('not prepared');
    if (action === 'cancel') s.cancel();
    if (action === 'replace') s.preview(before.ticket, () => '2');
    if (action === 'reset') s.resetHistory();
    if (action === 'dispose') s.dispose();
    assert.equal(document.publish(prepared.candidate).status, 'stale');
    assert.equal(document.read(), before);
  }
});
test('nested publication is busy and later external publication invalidates older prepared work', () => {
  const document = numbers(),
    ticket = document.read().ticket;
  const a = document.prepare(ticket, () => '1');
  if (a.status !== 'prepared') throw Error('not prepared');
  const b = document.prepare(ticket, () => {
    assert.equal(document.publish(a.candidate).status, 'busy');
    assert.equal(document.prepare(ticket, () => '8').status, 'busy');
    return '2';
  });
  if (b.status !== 'prepared') throw Error('not prepared');
  assert.equal(document.read().ticket, ticket);
  assert.equal(document.publish(b.candidate).status, 'accepted');
  assert.equal(document.publish(a.candidate).status, 'stale');
});
test('only literal true validates initial and staged documents; truthy and promise returns preserve session state', () => {
  const invalidReturns: unknown[] = [
    Promise.resolve(false),
    Promise.resolve(true),
    {},
    [],
    'yes',
    1,
    false,
    null,
    undefined,
  ];
  for (const invalid of invalidReturns) {
    const dishonest = (() => invalid) as unknown as (value: DocumentValue) => value is number;
    assert.throws(
      () => createAuthoredDocument({id: 'n', json: '0', limits, validate: dishonest}),
      /rejected initial document/,
    );
    let returned: unknown = true;
    const validate = (() => returned) as unknown as (value: DocumentValue) => value is number;
    const document = createAuthoredDocument({id: 'n', json: '0', limits, validate});
    const session = createAuthoringSession(document, history);
    session.preview(document.read().ticket, () => '1');
    session.commit();
    session.preview(document.read().ticket, () => '2');
    const snapshot = document.read(),
      draft = session.readPreview(),
      stats = session.stats();
    returned = invalid;
    assert.equal(session.preview(snapshot.ticket, () => '3').status, 'rejected');
    assert.equal(document.edit(snapshot.ticket, () => '4').status, 'rejected');
    assert.equal(session.undo().status, 'rejected');
    assert.equal(document.read(), snapshot);
    assert.equal(session.readPreview(), draft);
    assert.deepEqual(session.stats(), stats);
    returned = true;
    assert.equal(session.commit().status, 'accepted');
    assert.equal(document.read().value, 2);
  }
});
