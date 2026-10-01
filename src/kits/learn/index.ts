/**
 * kits/learn: learn mode. Lessons are data (lesson.ts: objectives, cast, an outline of typed scenes, action
 * timelines); a lesson plays as one engine scene whose body (the director, the chalkboard and the concept explorer)
 * loads only when the lesson is entered, so a game costs nothing for learn mode until a learner opens a lesson.
 *
 *   // game/day-night.ts
 *   export default lessonScene({ lesson, title: 'Day and night', sim: () => import('./day-night.body.mts') });
 *
 * This file stays small and eager: the kit (inputs, the progress section), the lesson model and `lessonScene`.
 * Design inspired by THU-MAIC OpenMAIC (see docs/guides/learn-mode.md).
 */
import { defineInput, defineKit, defineScene, type KitDefinition, type SceneBody, type SceneDefinition, type SceneInput } from '../../author';
import type { LessonInput, Lesson } from './lesson';
import type { DiscussProvider } from './provider';

export { defineLesson, lessonProblems, patchScene, defineLessonSceneType, lessonSceneTypes, longestPassiveRun, sceneSizeFor, type Lesson, type LessonInput, type LessonScene, type Action, type QuizQuestion, type CastMember } from './lesson';
export { scriptedProvider, kidSafeProblems, type DiscussProvider } from './provider';

const press = (id: string, label: string, keys: string[], pad: string[]) => defineInput({ id, label, keys, pad: pad as never });
export const LEARN_INPUTS = [
  press('learn-next', 'Next', ['Enter', 'Space', 'n'], ['a']),
  press('learn-back', 'Back a step', ['b'], ['lb']),
  press('learn-again', 'Show again', ['r'], ['y']),
  press('learn-hint', 'Hint', ['h'], ['rb']),
  press('learn-question', 'I have a question', ['q'], ['lt']),
  press('learn-pause', 'Pause or play', ['k'], ['rt']),
  press('learn-option-1', 'Answer 1', ['1'], ['dpad-left']),
  press('learn-option-2', 'Answer 2', ['2'], ['dpad-down']),
  press('learn-option-3', 'Answer 3', ['3'], ['dpad-right']),
  defineInput({ id: 'learn-param', label: 'Change the value', axis: { negative: { keys: ['['], pad: ['ls-left'] }, positive: { keys: [']'], pad: ['ls-right'] } } }),
];

export { learnProgress } from './progress';
import { learnProgress } from './progress';

export interface LessonSceneOptions {
  lesson: Lesson | LessonInput;
  title: string;
  view?: SceneInput['view'];
  /** The 3D content of sim and explore scenes: a lazy import of a SceneBody (entities with `Part`, systems). */
  sim?: () => Promise<SceneBody | { default: SceneBody }>;
  /** Who answers in discuss scenes (default: the lesson's authored interrupts). */
  provider?: DiscussProvider;
}
export type LessonSceneDefinition = SceneDefinition & { readonly lesson: LessonInput };

/** A lesson as an engine scene (`scene.<lesson id>`). Its body loads lazily with the learn runtime. */
export function lessonScene(o: LessonSceneOptions): LessonSceneDefinition {
  const scene = defineScene({
    id: o.lesson.id, title: o.title, type: 'lesson',
    view: o.view ?? { camera: { position: [0, 3, 8], target: [0, 0, 0], fov: 45, minWidthFov: 50 }, background: 0x0d1420 },
    body: async () => {
      const [{ lessonBody }, sim] = await Promise.all([import('./runtime'), o.sim ? o.sim() : Promise.resolve({})]);
      const extra = ('default' in sim ? sim.default : sim) as SceneBody;
      return lessonBody(o.lesson, extra, { provider: o.provider });
    },
  });
  return Object.assign(scene, { lesson: o.lesson });
}

/** The kit: the lesson inputs and the progress section. Requires the ui kit and the camera kit (the explorer's orbit). */
export function learn(): KitDefinition { return defineKit({ id: 'learn', requires: ['ui', 'camera'], defs: [...LEARN_INPUTS, learnProgress], strings: { en: LEARN_STRINGS } }); }

/** The kit's English words; a game overrides any of them in its own strings. */
export const LEARN_STRINGS: Record<string, string> = {
  'learn.next': 'Next', 'learn.back': 'Back', 'learn.again': 'Show again', 'learn.hint': 'Hint', 'learn.question': 'I have a question',
  'learn.pause': 'Pause', 'learn.play': 'Play', 'learn.finished': 'Lesson complete. Well done!', 'learn.objectives': 'Today you will learn',
  'learn.step': 'Step {n} of {total}', 'learn.controls': 'Lesson controls', 'learn.question-of': 'Question {n} of {total}',
};
