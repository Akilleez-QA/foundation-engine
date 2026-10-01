import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testScene } from '@engine';
import { lessonProblems } from '@kits/learn';
import brief from './build.brief';
import game from './game';
import dayNight from './day-night';
import lesson from './lesson';
import { flagAt } from './day-night.body.mts';

type Learn = { scene: string; type: string; waiting: string | null; param: number | null; met: string[]; quiz: { index: number; state: string; hints: number } | null; finished: boolean };
const learnOf = (t: Awaited<ReturnType<typeof testScene>>) => t.ctx.state.learn as Learn;
const next = (t: Awaited<ReturnType<typeof testScene>>) => { t.press('learn-next'); t.run(1 / 60); t.run(15); };

test('S1: every objective is taught and checked, and no scene has more than three passive steps in a row', () => {
  assert.deepEqual(lessonProblems(lesson, { maxPassive: brief.pedagogy.maxPassiveActions, ages: brief.audience.ages, text: k => game.strings!.en[k] ?? k }), []);
});

test('S2: turning the Earth past half a turn puts the flag in night and meets the second objective', async () => {
  assert.equal(flagAt(0).day, true);
  assert.equal(flagAt(180).day, false);
  const t = await testScene(dayNight, { game, brief });
  t.run(1);
  while (learnOf(t).scene !== 'turn') next(t);
  assert.equal(learnOf(t).type, 'sim');
  t.hold('learn-param', 1); t.run(2); t.release('learn-param'); t.run(15);
  assert.ok((learnOf(t).param ?? 0) >= 180);
  assert.equal(t.ctx.state.flagInDaylight, false);
  assert.ok(learnOf(t).met.includes('o2'));
  assert.equal(learnOf(t).waiting, 'next', 'the teacher went on once the learner turned the Earth');
});

test('S3: a wrong answer gets kind feedback and a hint before the answer is ever shown', async () => {
  const t = await testScene(dayNight, { game, brief });
  t.run(1);
  for (let i = 0; i < 30 && learnOf(t).type !== 'quiz'; i++) { if (learnOf(t).scene === 'turn') { t.hold('learn-param', 1); t.run(2); t.release('learn-param'); } next(t); }
  assert.equal(learnOf(t).type, 'quiz');
  t.run(5);
  t.press('learn-option-2'); t.run(1 / 60);   // q1: b is not the answer
  assert.deepEqual(learnOf(t).quiz, { index: 0, state: 'asking', hints: 1 }, 'still asking, with a hint');
  assert.ok(t.cues.includes('ui.bump'));
  t.press('learn-option-1'); t.run(1 / 60);
  assert.equal(learnOf(t).quiz?.state, 'right');
  for (const option of ['learn-option-2', 'learn-option-2']) { next(t); t.press(option); t.run(1 / 60); }
  next(t); t.run(1);
  next(t);
  assert.equal(learnOf(t).finished, true);
  assert.deepEqual(learnOf(t).met, ['o1', 'o2']);
});
