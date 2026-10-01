/**
 * kits/learn/generate: the `npm run new -- lesson <id>` generator. It writes an outline-first lesson (a board scene
 * that states the objective and shows one idea, and a quiz that checks it), the lesson's scene, a test, and the
 * lesson's words into the game's strings file. The author then grows the outline: one scene at a time, each
 * followed by `npm run play:snap` (the new-lesson skill).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { BuildBrief } from '../../author/build';

const pascal = (id: string) => id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('');

export function generateLesson(dir: string, id: string, brief: BuildBrief, root: string): { files: string[]; text: Record<string, string>; next: string[]; strings: string[] } {
  const rel = (f: string) => relative(root, join(dir, f)).split('\\').join('/');
  const c = id.replace(/-(\w)/g, (_, x: string) => x.toUpperCase());
  const k = (s: string) => `lesson.${id}.${s}`;
  const ages = brief.audience.ages ? `ages: [${brief.audience.ages[0]}, ${brief.audience.ages[1]}], ` : '';
  const text: Record<string, string> = {};
  text[rel(`${id}-lesson.ts`)] = `// The ${id} lesson as data. Grow the outline one scene at a time; every objective needs a scene and a check.
// Pacing (checked by npm run check): at most ${brief.pedagogy.maxPassiveActions} passive steps before the learner acts.
import { defineLesson } from '@kits/learn';

export default defineLesson({
  id: '${id}', version: 1, title: '${k('title')}', ${ages}
  objectives: [{ id: 'o1', text: '${k('o1')}' }],
  cast: [
    { id: 'teacher', name: '${k('teacher')}', role: 'teacher', color: '#ffd166' },
    { id: 'mate', name: '${k('mate')}', role: 'classmate', color: '#7bd88f' },
  ],
  outline: [
    { id: 'intro', type: 'board', objective: 'o1' },
    { id: 'check', type: 'quiz', objective: 'o1' },
  ],
  scenes: {
    intro: {
      type: 'board', title: '${k('intro.title')}',
      board: { items: [{ id: 'idea', kind: 'text', at: [20, 45], text: '${k('idea')}', size: 8 }] },
      timeline: [
        { do: 'objectives' },
        { do: 'say', who: 'teacher', text: '${k('hello')}' },
        { do: 'wait-for', event: 'next' },
        { do: 'write', target: 'idea' },
        { do: 'say', who: 'teacher', text: '${k('explain')}' },
        { do: 'say', who: 'mate', text: '${k('asks')}' },
        { do: 'wait-for', event: 'next' },
      ],
      interrupts: { question: [{ do: 'say', who: 'teacher', text: '${k('answer')}' }] },
    },
    check: {
      type: 'quiz', title: '${k('check.title')}',
      timeline: [{ do: 'say', who: 'teacher', text: '${k('quiz-intro')}' }, { do: 'wait-for', event: 'answer' }],
      quiz: { questions: [
        { id: 'q1', objective: 'o1', prompt: '${k('q1')}', options: [{ id: 'a', text: '${k('q1.a')}' }, { id: 'b', text: '${k('q1.b')}' }], answer: 'a', hints: ['${k('q1.hint')}'], feedback: { right: '${k('right')}', retry: '${k('retry')}' } },
      ] },
    },
  },
});
`;
  text[rel(`${id}.ts`)] = `// The ${id} lesson as a scene; its body (the learn runtime) loads only when the lesson opens.
import { lessonScene } from '@kits/learn';
import lesson from './${id}-lesson';

export default lessonScene({ lesson, title: '${pascal(id).replace(/([a-z])([A-Z])/g, '$1 $2')}' });
`;
  text[rel(`${id}.test.ts`)] = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lessonProblems } from '@kits/learn';
import brief from './build.brief';
import game from './game';
import lesson from './${id}-lesson';

test('${id}: every objective is taught and checked, and the pacing rules hold', () => {
  const strings: Record<string, string> = { ...Object.assign({}, ...(game.kits ?? []).map(k => k.strings.en ?? {})), ...game.strings?.en };
  assert.deepEqual(lessonProblems(lesson, { maxPassive: brief.pedagogy.maxPassiveActions, ages: brief.audience.ages, text: key => strings[key] ?? key }), []);
});
`;
  const words: Record<string, string> = {
    [k('title')]: pascal(id).replace(/([a-z])([A-Z])/g, '$1 $2'), [k('o1')]: '<what the learner will be able to do>', [k('teacher')]: 'Teacher', [k('mate')]: 'Alex',
    [k('intro.title')]: 'The idea', [k('idea')]: '<the one idea, in a few words>', [k('hello')]: '<a friendly opening line>',
    [k('explain')]: '<one sentence that explains the idea>', [k('asks')]: '<the question a classmate would ask>', [k('answer')]: '<the teacher\'s answer to a question>',
    [k('check.title')]: 'Check', [k('quiz-intro')]: 'One quick question.', [k('q1')]: '<a question about the idea>', [k('q1.a')]: '<the right answer>',
    [k('q1.b')]: '<a tempting wrong answer>', [k('q1.hint')]: '<a hint that helps without giving it away>', [k('right')]: 'Yes, well done!', [k('retry')]: 'Nice try. Here is a hint.',
  };
  const stringsFile = join(dir, 'strings.en.json');
  const existing = existsSync(stringsFile) ? JSON.parse(readFileSync(stringsFile, 'utf8')) as Record<string, string> : null;
  const next = [`Write the words: ${rel('strings.en.json')} (every <…>)`, `Then grow the outline in ${rel(`${id}-lesson.ts`)}: outline -> scenes -> npm run play:snap -- --scene ${id} after each`, 'Needs the kits ui, camera, concept-explorer and learn in game.ts'];
  if (existing) { writeFileSync(stringsFile, JSON.stringify({ ...existing, ...words }, null, 2) + '\n'); return { files: Object.keys(text), text, next, strings: [rel('strings.en.json') + ' (lesson words)'] }; }
  text[rel('strings.en.json')] = JSON.stringify(words, null, 2) + '\n';
  next.unshift("In game.ts: import strings from './strings.en.json' and pass strings: { en: strings } to defineGame");
  return { files: Object.keys(text), text, next, strings: [] };
}
