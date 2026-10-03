/**
 * kits/learn/lesson: the lesson model. A lesson is plain, versioned, JSON-serialisable data:
 *
 *   objectives   what the learner will be able to do, each with a stable id
 *   cast         a teacher, an optional helper and one or two classmates (names are string keys)
 *   outline      ordered items: a scene type and the objective it serves; each item expands into a scene
 *   scenes       one per outline item, keyed by the item's stable id: a timeline of actions (timeline.ts) and the
 *                type's own data (a board's items, a quiz's questions, a sim's parameter, a project's milestones)
 *
 * `patchScene` replaces one scene atomically (the whole patch validates, or nothing changes). `lessonProblems`
 * checks the lesson and the pedagogy rules that can be checked (AGENTS.md, "Teaching"). Scene types are an open
 * registry (`defineLessonSceneType`). Nothing here touches the DOM or three.js.
 */
import type { BoardItem } from '../chalkboard/board';

export type Key = string;
export type CastId = 'teacher' | 'helper' | string;

/** Timeline actions. Targets are stable ids: board items, 3D parts, cast members. */
export type Action =
  | { do: 'say'; who: CastId; text: Key }
  | { do: 'objectives' }
  | { do: 'draw'; target: string }
  | { do: 'write'; target: string }
  | { do: 'reveal'; target: string }
  | { do: 'hide'; target: string }
  | { do: 'spotlight'; target: string | null }
  | { do: 'point'; target: string | null }
  | { do: 'camera'; yaw?: number; pitch?: number; distance?: number }
  | { do: 'wait-for'; event: 'next' | 'answer' | 'param' | 'part' | 'milestone' | 'discuss'; prompt?: Key; min?: number }
  | { do: 'branch'; if: { answer: string; is: string } | { param: string; atLeast: number }; then: Action[]; else?: Action[] };

export const PASSIVE = new Set<Action['do']>(['say', 'objectives', 'draw', 'write', 'reveal', 'hide', 'spotlight', 'point', 'camera']);

export interface QuizQuestion {
  id: string; objective: string; prompt: Key;
  options: { id: string; text: Key }[];
  answer: string;
  /** Shown one at a time before the answer is ever revealed. */
  hints: Key[];
  feedback: { right: Key; retry: Key };
}
export interface LessonScene {
  type: string;
  title: Key;
  timeline: Action[];
  /** Authored answers to the learner's interrupts. 'again' replays the scene when not given. */
  interrupts?: { question?: Action[]; hint?: Action[]; again?: Action[] };
  board?: { items: BoardItem[]; caption?: Key };
  quiz?: { questions: QuizQuestion[] };
  sim?: { param: { id: string; label: Key; min: number; max: number; step: number; start: number }; checks: { objective: string; atLeast: number }[] };
  explore?: { parts: string[]; checks: { objective: string; part: string }[] };
  project?: { milestones: { id: string; objective: string; text: Key }[] };
  discuss?: { prompts: { id: string; text: Key }[] };
}
export interface CastMember { id: CastId; name: Key; role: 'teacher' | 'helper' | 'classmate'; color: string }
export interface LessonInput {
  id: string; version: number; title: Key;
  /** Learner ages; sizes the scenes (default from the brief). */
  ages?: readonly [number, number];
  objectives: { id: string; text: Key }[];
  cast: CastMember[];
  outline: { id: string; type: string; objective: string }[];
  scenes: Record<string, LessonScene>;
}
export interface Lesson extends LessonInput { readonly kind: 'lesson' }

// ------------------------------------------------------------------ scene types (open registry)

export interface LessonSceneType { id: string; interactive: boolean; problems(scene: LessonScene): string[] }
const TYPES = new Map<string, LessonSceneType>();
export function defineLessonSceneType(t: LessonSceneType): LessonSceneType { if (TYPES.has(t.id)) throw Error(`lesson scene type '${t.id}' is defined twice`); TYPES.set(t.id, t); return t; }
export const lessonSceneTypes = (): readonly LessonSceneType[] => [...TYPES.values()];

const has = (s: LessonScene, d: Action['do']) => flatten(s.timeline).some(a => a.do === d);
defineLessonSceneType({ id: 'board', interactive: false, problems: s => [
  ...(!s.board ? ['a board scene needs board.items'] : []),
  ...(has(s, 'say') && (has(s, 'draw') || has(s, 'write') || has(s, 'reveal')) ? [] : ['a board scene both says and shows (multimodal): add a say and a draw, write or reveal']),
  ...flatten(s.timeline).filter(a => 'target' in a && a.target && ['draw', 'write', 'reveal', 'hide'].includes(a.do) && !s.board?.items.some(i => i.id === a.target)).map(a => `${a.do} targets unknown board item '${(a as { target: string }).target}'`),
] });
defineLessonSceneType({ id: 'quiz', interactive: true, problems: s => {
  const qs = s.quiz?.questions ?? [];
  const out = qs.length ? [] : ['a quiz needs questions'];
  for (const q of qs) {
    if (q.options.length < 2 || q.options.length > 3) out.push(`${q.id}: give 2 or 3 options`);
    if (!q.options.some(o => o.id === q.answer)) out.push(`${q.id}: the answer is not an option`);
    if (!q.hints.length) out.push(`${q.id}: hints before answers: give at least one hint`);
  }
  return out;
} });
defineLessonSceneType({ id: 'sim', interactive: true, problems: s => (s.sim ? (s.sim.param.min < s.sim.param.max ? [] : ['sim param: min < max']) : ['a sim scene needs sim.param']) });
defineLessonSceneType({ id: 'explore', interactive: true, problems: s => (s.explore?.parts.length ? [] : ['an explore scene names the parts to find']) });
defineLessonSceneType({ id: 'project', interactive: true, problems: s => { const n = s.project?.milestones.length ?? 0; return n >= 2 && n <= 4 ? [] : ['a project has 2 to 4 milestones']; } });
defineLessonSceneType({ id: 'discuss', interactive: true, problems: s => (s.discuss?.prompts.length ? [] : ['a discuss scene offers prompts to choose from']) });

// ------------------------------------------------------------------ helpers

/** Every action, branches included (both arms). */
export function flatten(actions: readonly Action[]): Action[] {
  return actions.flatMap(a => (a.do === 'branch' ? [a, ...flatten(a.then), ...flatten(a.else ?? [])] : [a]));
}

/** The longest run of passive actions before the learner acts, along any branch path. */
export function longestPassiveRun(actions: readonly Action[], run = 0): number {
  let best = run, cur = run;
  for (const [i, a] of actions.entries()) {
    if (a.do === 'branch') {
      const rest = actions.slice(i + 1);
      return Math.max(best, longestPassiveRun([...a.then, ...rest], cur), longestPassiveRun([...(a.else ?? []), ...rest], cur));
    }
    cur = PASSIVE.has(a.do) ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

/** How long a scene may be for an age band: most steps to watch (actions other than waits and branches) per scene. */
export const sceneSizeFor = (ages?: readonly [number, number]) => !ages ? 20 : ages[1] <= 8 ? 10 : ages[1] <= 11 ? 14 : 20;
const UNKIND = /\b(wrong|stupid|dumb|bad|fail(ed|ure)?|idiot|lazy|terrible|no!)\b/i;

/** `pacing: false` checks structure only (defineLesson); the brief lint checks pacing with the brief's numbers. */
export interface LessonCheckOptions { maxPassive?: number; ages?: readonly [number, number] | undefined; text?: (key: Key) => string; kids?: boolean; pacing?: boolean }

export function lessonProblems(l: LessonInput, o: LessonCheckOptions = {}): string[] {
  const out: string[] = [];
  const maxPassive = o.maxPassive ?? 3, size = sceneSizeFor(l.ages ?? o.ages), text = o.text ?? ((k: Key) => k);
  if (!/^[a-z][a-z0-9-]*$/.test(l.id)) out.push(`lesson id '${l.id}' must be kebab-case`);
  if (!Number.isInteger(l.version) || l.version < 1) out.push('version is a positive integer (bump it when the lesson changes)');
  if (!l.objectives.length) out.push('state at least one objective');
  const teachers = l.cast.filter(c => c.role === 'teacher'), mates = l.cast.filter(c => c.role === 'classmate');
  if (teachers.length !== 1) out.push('the cast has exactly one teacher');
  if (l.cast.filter(c => c.role === 'helper').length > 1) out.push('at most one helper');
  if (mates.length > 2) out.push('one or two classmates at most');
  const castIds = new Set(l.cast.map(c => c.id));
  const ids = new Set<string>();
  for (const item of l.outline) {
    if (ids.has(item.id)) out.push(`outline id '${item.id}' is used twice`);
    ids.add(item.id);
    const s = l.scenes[item.id];
    if (!s) { out.push(`outline item '${item.id}' has no scene`); continue; }
    if (s.type !== item.type) out.push(`${item.id}: the outline says ${item.type}, the scene is ${s.type}`);
    if (!l.objectives.some(ob => ob.id === item.objective)) out.push(`${item.id}: unknown objective '${item.objective}'`);
    const type = TYPES.get(s.type);
    if (!type) { out.push(`${item.id}: unknown scene type '${s.type}' (defineLessonSceneType)`); continue; }
    out.push(...type.problems(s).map(p => `${item.id}: ${p}`));
    const all = flatten([...s.timeline, ...s.interrupts?.question ?? [], ...s.interrupts?.hint ?? [], ...s.interrupts?.again ?? []]);
    for (const a of all) if (a.do === 'say' && !castIds.has(a.who)) out.push(`${item.id}: '${a.who}' is not in the cast`);
    const run = o.pacing === false ? 0 : longestPassiveRun(s.timeline);
    if (run > maxPassive) out.push(`${item.id}: ${run} passive actions in a row; the learner acts at least every ${maxPassive} (add a wait-for, a question or an interaction)`);
    const shown = flatten(s.timeline).filter(a => a.do !== 'wait-for' && a.do !== 'branch').length;
    if (o.pacing !== false && shown > size) out.push(`${item.id}: ${shown} steps to watch; keep scenes to ${size} for ages ${(l.ages ?? o.ages ?? ['?', '?']).join('–')} (split it)`);
    for (const q of s.quiz?.questions ?? []) for (const k of [q.feedback.right, q.feedback.retry, ...q.hints]) if (UNKIND.test(text(k))) out.push(`${item.id}/${q.id}: feedback is kind: reword "${text(k)}"`);
  }
  for (const id of Object.keys(l.scenes)) if (!ids.has(id)) out.push(`scene '${id}' is not in the outline`);
  const first = l.outline[0];
  if (first && !flatten(l.scenes[first.id]?.timeline ?? []).some(a => a.do === 'objectives')) out.push('state the objectives: the first scene has an { do: "objectives" } action');
  for (const ob of l.objectives) {
    const scenes = l.outline.filter(i => i.objective === ob.id);
    const checks = Object.values(l.scenes).flatMap(s => [...s.quiz?.questions.filter(q => q.objective === ob.id) ?? [], ...s.sim?.checks.filter(c => c.objective === ob.id) ?? [], ...s.explore?.checks.filter(c => c.objective === ob.id) ?? [], ...s.project?.milestones.filter(m => m.objective === ob.id) ?? []]);
    if (!scenes.length) out.push(`objective ${ob.id} is taught by no scene`);
    if (!checks.length) out.push(`objective ${ob.id} is checked nowhere (a quiz question, a sim check, an explore check or a project milestone)`);
  }
  try { JSON.parse(JSON.stringify(l)); } catch { out.push('a lesson is plain data (JSON-serialisable)'); }
  return out;
}

export function defineLesson(l: LessonInput): Lesson {
  const problems = lessonProblems(l, { pacing: false });
  if (problems.length) throw Error(`lesson ${l.id}: ${problems.join('; ')}`);
  return { ...l, kind: 'lesson' };
}

/** Replace one scene atomically: the patched lesson must validate, or the original is returned unchanged with the problems. */
export function patchScene(l: Lesson, id: string, patch: (scene: LessonScene) => LessonScene, o: LessonCheckOptions = {}): { lesson: Lesson; problems: string[] } {
  if (!l.scenes[id]) return { lesson: l, problems: [`no scene '${id}'`] };
  const next: Lesson = { ...l, version: l.version + 1, scenes: { ...l.scenes, [id]: patch(structuredClone(l.scenes[id])) } };
  const problems = lessonProblems(next, o);
  return problems.length ? { lesson: l, problems } : { lesson: next, problems: [] };
}
