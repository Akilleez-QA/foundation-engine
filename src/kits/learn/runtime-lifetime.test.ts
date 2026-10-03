import test from 'node:test';
import assert from 'node:assert/strict';
import { defineScene } from '../../author';
import { testScene } from '../../author/testing';
import { installFakeDom, live } from '../../testing/fake-dom';
import { lessonScene } from './index';
import type { LessonInput } from './lesson';
import { directorSystem, disposeLesson } from './runtime';
import { must } from '../../testing/must';

const lesson: LessonInput = {
  id: 'lifetime', version: 1, title: 'Lifetime',
  objectives: [{ id: 'adjust', text: 'Adjust' }],
  cast: [{ id: 'teacher', name: 'Teacher', role: 'teacher', color: '#fff' }],
  outline: [{ id: 'sim', type: 'sim', objective: 'adjust' }, { id: 'other', type: 'sim', objective: 'adjust' }],
  scenes: Object.fromEntries(['sim', 'other'].map(id => [id, {
    type: 'sim', title: id,
    timeline: [{ do: 'say', who: 'teacher', text: 'Adjust the value' }, { do: 'wait-for', event: 'next' }],
    sim: { param: { id, label: id, min: 0, max: 10, start: 0, step: 1 }, checks: [{ objective: 'adjust', atLeast: 0 }] },
  }])),
};

// Fake DOM tests ownership and callbacks, not geometry or device acceptance.
test('lessonScene exit retires its lazy runtime UI, including before the first frame', async () => {
  const fake = installFakeDom();
  try {
    const scene = lessonScene({ lesson, title: 'Lifetime' });
    const empty = await testScene(scene); empty.dispose(); empty.dispose();
    const observers = live.observers;
    for (let i = 0; i < 2; i++) {
      const h = await testScene(scene), overlay = fake.document.createElement('div');
      fake.document.body.append(overlay);
      Object.assign(h.ctx.view, { overlay });
      h.run(1 / 60);
      assert.equal(overlay.querySelectorAll('nav').length, 1);
      assert.equal(overlay.querySelectorAll('.explorer-slider').length, 1);
      h.dispose(); h.dispose();
      assert.equal(overlay.querySelectorAll('nav').length, 0);
      assert.equal(overlay.querySelectorAll('.explorer-slider').length, 0);
      assert.equal(overlay.querySelectorAll('[aria-live=polite]').length, 0);
      assert.equal(live.observers, observers, 'the layout ResizeObserver is released on exit');
      overlay.remove();
    }
  } finally { fake.restore(); }
});

test('explicit disposal clears queued controls and stale slider input before a replacement visit', async () => {
  const fake = installFakeDom();
  const h = await testScene(defineScene({ id: 'lifetime', title: 'Lifetime', systems: [directorSystem(lesson)], exit: disposeLesson }));
  try {
    const overlay = fake.document.createElement('div'); fake.document.body.append(overlay);
    Object.assign(h.ctx.view, { overlay });
    h.run(1 / 60);
    const pause = overlay.querySelector('[data-command=pause]')!, slider = overlay.querySelector('input')!;
    pause.click(); // Queued, deliberately not consumed by a frame.
    slider.value = '9'; slider.dispatchEvent({ type: 'input' });
    const observing = live.observers;
    disposeLesson(h.ctx); disposeLesson(h.ctx);
    assert.equal(overlay.children.length, 0);
    assert.equal(live.observers, observing - 1, 'disposeLesson releases the controls\' ResizeObserver exactly once');
    h.run(1 / 60); // A new visit for the same world must not retain queued commands.
    pause.click(); slider.value = '8'; slider.dispatchEvent({ type: 'input' });
    h.run(1 / 60);
    const state = h.ctx.state.learn as { paused: boolean; param: number };
    assert.equal(state.paused, false);
    assert.equal(state.param, 0);
    assert.equal(overlay.querySelectorAll('nav').length, 1);
  } finally { h.dispose(); fake.restore(); }
});

test('changing lesson subscenes destroys the previous slider instead of retaining hidden controls', async () => {
  const fake = installFakeDom();
  const h = await testScene(defineScene({ id: 'lifetime', title: 'Lifetime', systems: [directorSystem(lesson)], exit: disposeLesson }));
  try {
    const overlay = fake.document.createElement('div'); fake.document.body.append(overlay);
    Object.assign(h.ctx.view, { overlay }); h.run(3);
    const old = overlay.querySelector('input')!;
    h.press('learn-next'); h.run(1 / 60);
    h.press('learn-next'); h.run(1 / 60);
    assert.equal((h.ctx.state.learn as { scene: string }).scene, 'other');
    assert.equal(overlay.querySelectorAll('.explorer-slider').length, 1);
    assert.notEqual(overlay.querySelector('input'), old);
    old.value = '9'; old.dispatchEvent({ type: 'input' }); h.run(1 / 60);
    assert.equal((h.ctx.state.learn as { param: number }).param, 0);
  } finally { h.dispose(); fake.restore(); }
});

test('board transition removes the previous nonboard caption and exit removes the board', async () => {
  const fake = installFakeDom();
  // Only element construction is needed for this empty-board ownership assertion.
  Object.assign(fake.document, { createElementNS: (_ns: string, tag: string) => fake.document.createElement(tag) });
  const mixed = structuredClone(lesson);
  must(mixed.outline[1]).type = 'board';
  mixed.scenes.other = { type: 'board', title: 'Board', board: { items: [] }, timeline: [{ do: 'wait-for', event: 'next' }] };
  const h = await testScene(defineScene({ id: 'lifetime', title: 'Lifetime', systems: [directorSystem(mixed)], exit: disposeLesson }));
  try {
    const overlay = fake.document.createElement('div'); fake.document.body.append(overlay);
    Object.assign(overlay, { prepend: (node: typeof overlay) => overlay.append(node) });
    Object.assign(h.ctx.view, { overlay }); h.run(3);
    const caption = overlay.querySelectorAll('p').find(el => el.textContent.includes('Adjust the value'))!;
    assert.ok(caption);
    h.press('learn-next'); h.run(1 / 60);
    h.press('learn-next'); h.run(1 / 60);
    assert.equal(caption.parentElement, null);
    assert.equal(overlay.querySelectorAll('.chalkboard').length, 1);
    h.dispose(); assert.equal(overlay.children.length, 0);
  } finally { h.dispose(); fake.restore(); }
});

test('one view cleanup failure does not retain other lesson resources or repeat cleanup', async () => {
  const fake = installFakeDom();
  const h = await testScene(defineScene({ id: 'lifetime', title: 'Lifetime', systems: [directorSystem(lesson)], exit: disposeLesson }));
  try {
    const overlay = fake.document.createElement('div'); fake.document.body.append(overlay);
    Object.assign(h.ctx.view, { overlay }); h.run(1 / 60);
    const nav = overlay.querySelector('nav')!;
    let attempts = 0;
    nav.remove = () => { attempts++; throw Error('synthetic cleanup failure'); };
    assert.throws(() => disposeLesson(h.ctx), { name: 'AggregateError', message: 'Lesson UI cleanup failed' });
    assert.equal(overlay.querySelectorAll('.explorer-slider').length, 0);
    assert.equal(overlay.querySelectorAll('[aria-live=polite]').length, 0);
    disposeLesson(h.ctx); assert.equal(attempts, 1);
  } finally { h.dispose(); fake.restore(); }
});
