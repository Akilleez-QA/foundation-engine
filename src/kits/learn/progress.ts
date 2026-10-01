/** kits/learn/progress: every lesson's saved progress (a save section of the learn kit). */
import { defineSaveSection } from '../../author';
import type { LessonProgress } from './director';

/** Every lesson's progress, keyed by lesson id. Progress never un-happens: objectives met are a union. */
export const learnProgress = defineSaveSection({
  id: 'learn.progress',
  initial: { lessons: {} as Record<string, LessonProgress> },
  merge: (a, b) => {
    const out = { lessons: { ...a.lessons } };
    for (const [id, p] of Object.entries(b.lessons)) {
      const q = out.lessons[id];
      out.lessons[id] = !q || p.version > q.version ? p : { ...q, scene: Math.max(q.scene, p.scene), met: [...new Set([...q.met, ...p.met])].sort(), done: q.done || p.done, answers: { ...q.answers, ...p.answers } };
    }
    return out;
  },
});

