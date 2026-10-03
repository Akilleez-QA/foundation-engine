import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineLesson, defineLessonSceneType, lessonProblems, longestPassiveRun, patchScene, type LessonInput } from './lesson';
import { LessonDirector } from './director';
import { must } from '../../testing/must';

export const tiny: LessonInput = {
  id: 'tiny', version: 1, title: 'Tiny', ages: [8, 10],
  objectives: [{ id: 'o1', text: 'Count to two' }],
  cast: [{ id: 'teacher', name: 'Teacher', role: 'teacher', color: '#fff' }, { id: 'kim', name: 'Kim', role: 'classmate', color: '#0f0' }],
  outline: [{ id: 'b', type: 'board', objective: 'o1' }, { id: 'q', type: 'quiz', objective: 'o1' }],
  scenes: {
    b: { type: 'board', title: 'Board', board: { items: [{ id: 'one', kind: 'text', at: [10, 10], text: 'one' }] }, timeline: [
      { do: 'objectives' }, { do: 'say', who: 'teacher', text: 'Look' }, { do: 'write', target: 'one' }, { do: 'wait-for', event: 'next' },
      { do: 'say', who: 'kim', text: 'What comes next?' }, { do: 'wait-for', event: 'next' },
    ], interrupts: { question: [{ do: 'say', who: 'teacher', text: 'Two comes next.' }] } },
    q: { type: 'quiz', title: 'Quiz', timeline: [{ do: 'say', who: 'teacher', text: 'Your turn' }, { do: 'wait-for', event: 'answer' }], quiz: { questions: [
      { id: 'q1', objective: 'o1', prompt: 'After one?', options: [{ id: 'a', text: 'two' }, { id: 'b', text: 'ten' }], answer: 'a', hints: ['It is small'], feedback: { right: 'Yes!', retry: 'Nice try, here is a hint.' } },
    ] } },
  },
};

test('lesson: a valid lesson passes; it is plain data that survives JSON', () => {
  assert.deepEqual(lessonProblems(tiny), []);
  const l = defineLesson(tiny);
  assert.deepEqual(JSON.parse(JSON.stringify(l)), l);
});

test('lesson: objectives must be taught and checked; unknown types, cast and targets are named', () => {
  const broken: LessonInput = structuredClone(tiny);
  broken.objectives.push({ id: 'o2', text: 'Count to three' });
  must(broken.scenes.b).timeline.push({ do: 'draw', target: 'nothing' }, { do: 'say', who: 'ghost', text: 'boo' });
  broken.outline.push({ id: 'x', type: 'dance', objective: 'o1' }); broken.scenes.x = { type: 'dance', title: 'X', timeline: [] };
  const p = lessonProblems(broken).join('\n');
  assert.match(p, /objective o2 is taught by no scene/);
  assert.match(p, /objective o2 is checked nowhere/);
  assert.match(p, /unknown board item 'nothing'/);
  assert.match(p, /'ghost' is not in the cast/);
  assert.match(p, /unknown scene type 'dance'/);
});

test('lesson: pacing: no more than N passive actions in a row, along every branch; kind feedback; hints before answers', () => {
  assert.equal(longestPassiveRun([{ do: 'say', who: 't', text: 'a' }, { do: 'branch', if: { answer: 'q', is: 'a' }, then: [{ do: 'say', who: 't', text: 'b' }, { do: 'say', who: 't', text: 'c' }], else: [] }, { do: 'wait-for', event: 'next' }]), 3);
  const slow: LessonInput = structuredClone(tiny);
  must(slow.scenes.b).timeline.splice(3, 0, { do: 'reveal', target: 'one' });
  assert.match(lessonProblems(slow, { maxPassive: 3 }).join(), /b: 4 passive actions in a row/);
  assert.deepEqual(lessonProblems(slow, { maxPassive: 4 }), []);
  const harsh: LessonInput = structuredClone(tiny);
  must(must(harsh.scenes.q).quiz?.questions[0]).feedback.retry = 'Wrong!'; must(must(harsh.scenes.q).quiz?.questions[0]).hints = [];
  const p = lessonProblems(harsh).join('\n');
  assert.match(p, /feedback is kind/); assert.match(p, /hints before answers/);
});

test('lesson: patchScene is atomic: a valid patch bumps the version, an invalid one changes nothing', () => {
  const l = defineLesson(tiny);
  const ok = patchScene(l, 'b', s => ({ ...s, title: 'Counting' }));
  assert.deepEqual(ok.problems, []); assert.equal(ok.lesson.version, 2); assert.equal(must(ok.lesson.scenes.b).title, 'Counting'); assert.equal(must(l.scenes.b).title, 'Board');
  const bad = patchScene(l, 'q', s => ({ ...s, quiz: { questions: [] } }));
  assert.equal(bad.lesson, l); assert.match(bad.problems.join(), /a quiz needs questions/);
});

test('lesson: scene types are an open registry', () => {
  defineLessonSceneType({ id: 'test-listen', interactive: false, problems: () => [] });
  const l: LessonInput = structuredClone(tiny);
  l.outline.push({ id: 'l', type: 'test-listen', objective: 'o1' }); l.scenes.l = { type: 'test-listen', title: 'Listen', timeline: [{ do: 'wait-for', event: 'next' }] };
  assert.deepEqual(lessonProblems(l), []);
  assert.throws(() => defineLessonSceneType({ id: 'board', interactive: false, problems: () => [] }), /defined twice/);
});

test('director: gates, interrupts, kind quiz feedback with hints first, and saved progress', () => {
  const saved: { p?: unknown } = {};
  const cues: string[] = [];
  const d = new LessonDirector(defineLesson(tiny), { save: { get: () => saved.p as never, set: p => { saved.p = p; } }, cue: c => cues.push(c) });
  d.tick(10);
  assert.equal(d.view().timeline.waiting?.event, 'next');
  assert.equal(d.view().timeline.objectives, true);
  d.question();
  assert.equal(d.view().interrupt, true); assert.equal(d.main.paused, true);
  d.tick(10);
  assert.equal(d.view().interrupt, false, 'the interrupt played and the lesson resumed');
  d.next(); d.tick(10); d.next();
  assert.equal(d.view().scene.id, 'q');
  d.tick(10);
  d.answer('b');
  assert.deepEqual([d.view().quiz?.state, d.view().quiz?.hints, d.view().quiz?.feedback], ['asking', ['It is small'], 'Nice try, here is a hint.']);
  d.answer('b');
  assert.equal(d.view().quiz?.state, 'revealed', 'the answer is shown only after every hint');
  d.next();
  assert.equal(d.view().timeline.done, true);
  d.next();
  assert.equal(d.view().finished, true);
  assert.deepEqual((saved.p as { scene: number; done: boolean }).done, true);
  assert.deepEqual(cues, ['ui.bump']);
  const again = new LessonDirector(defineLesson(tiny), { save: { get: () => saved.p as never, set: () => {} } });
  assert.equal(again.view().scene.id, 'q', 'progress resumes where the learner was');
});
