/**
 * kits/learn/runtime: a lesson's scene body, loaded lazily when the lesson is entered. Systems, in order:
 *   learn-director (frame)  the director: learner input (keys, pad, buttons), the timeline, interrupts, the quiz,
 *                           the sim parameter; the chalkboard, controls, quiz panel and slider are updated from its view
 *   <the game's sim systems>  read `ctx.state.learn` (scene type, parameter value)
 *   explorer (frame)        the concept explorer, enabled in sim and explore scenes
 * World state `ctx.state.learn` = { scene, type, index, count, waiting, param, met, finished } for systems, probes and
 * play scripts.
 */
import { defineSystem, type SceneBody, type SceneContext, type SystemDefinition } from '../../author';
import { createBoardView, type BoardView } from '../chalkboard';
import { createQuizPanel, createSlider, explorer, explorerSystem, type QuizPanel, type Slider } from '../concept-explorer';
import { LessonDirector, type LessonView } from './director';
import { createControls, type Controls, type LessonCommand } from './ui';
import type { LessonInput, Lesson } from './lesson';
import type { DiscussProvider } from './provider';
import { learnProgress } from './progress';

const say = (ctx: SceneContext, key: string, vars?: Record<string, string | number>) => ctx.text(key, vars);

interface Visit { director: LessonDirector; board: BoardView | null; boardScene: string; controls: Controls | null; quiz: QuizPanel | null; slider: Slider | null; sliderScene: string; commands: LessonCommand[]; answers: string[]; param: number | null }
const visits = new WeakMap<object, Visit>();

export function directorSystem(lesson: Lesson | LessonInput, o: { provider?: DiscussProvider } = {}): SystemDefinition {
  return defineSystem({
    id: 'learn-director', phase: 'frame',
    run(ctx, dt) {
      let v = visits.get(ctx.world);
      if (!v) {
        const save = ctx.save(learnProgress);
        const director = new LessonDirector({ ...lesson, kind: 'lesson' }, {
          text: key => ctx.text(key), reducedMotion: ctx.time.calm, provider: o.provider, kidSafe: ctx.brief?.policy === 'kid-safe', cue: id => ctx.play(id),
          save: { get: () => save.get().lessons[lesson.id], set: p => save.update(d => { d.lessons[lesson.id] = p; }) },
        });
        v = { director, board: null, boardScene: '', controls: null, quiz: null, slider: null, sliderScene: '', commands: [], answers: [], param: null };
        visits.set(ctx.world, v);
        if (ctx.view.overlay) {
          v.controls = createControls(ctx.view.overlay);
          v.controls.onCommand(c => { v!.commands.push(c); });
          v.quiz = createQuizPanel(ctx.view.overlay, { questionOf: (n, total) => say(ctx, 'learn.question-of', { n, total }), hintLabel: say(ctx, 'learn.hint') });
          v.quiz.onAnswer(id => { v!.answers.push(id); });
        }
      }
      const d = v.director, input = ctx.input;
      const commands: LessonCommand[] = [...v.commands]; v.commands.length = 0;
      for (const c of ['next', 'back', 'again', 'hint', 'question', 'pause'] as const) if (input.pressed(`learn-${c}`)) commands.push(c);
      for (const c of commands) {
        if (c === 'pause') { if (d.main.paused) d.resume(); else d.pause(); } else d[c]();
      }
      const quiz = d.view().quiz;
      for (const k of [1, 2, 3]) if (input.pressed(`learn-option-${k}`) && quiz?.options[k - 1]) v.answers.push(quiz.options[k - 1].id);
      for (const a of v.answers) d.answer(a);
      v.answers.length = 0;
      const sim = d.scene.sim;
      if (sim) {
        const axis = input.axis('learn-param');
        if (axis) d.setParam((d.params[sim.param.id] ?? sim.param.start) + axis * (sim.param.max - sim.param.min) * 0.35 * dt);
        if (v.param !== null) { d.setParam(v.param); v.param = null; }
      }
      for (const e of ctx.world.read<{ id: string }>('part')) d.findPart(e.id);
      d.tick(dt);
      const view = d.view();
      publish(ctx, d, view);
      const ex = explorer(ctx);
      ex.enabled = view.scene.type === 'sim' || view.scene.type === 'explore';
      if (view.timeline.camera) Object.assign(ex.orbit, view.timeline.camera);
      render(ctx, v, view);
    },
  });
}

function publish(ctx: SceneContext, d: LessonDirector, view: LessonView) {
  const sim = view.sim;
  ctx.state.learn = {
    scene: view.scene.id, type: view.scene.type, index: view.scene.index, count: view.scene.count,
    waiting: view.timeline.waiting?.event ?? null, param: sim ? sim.value : null, caption: view.timeline.caption?.text ?? null,
    quiz: view.quiz ? { index: view.quiz.index, state: view.quiz.state, hints: view.quiz.hints.length } : null,
    met: view.objectives.filter(o => o.met).map(o => o.id), finished: view.finished, paused: d.main.paused,
  };
}

function render(ctx: SceneContext, v: Visit, view: LessonView) {
  const overlay = ctx.view.overlay;
  if (!overlay) return;
  const s = v.director.scene;
  // The chalkboard: one per board scene, built when the scene starts.
  if (v.boardScene !== view.scene.id) {
    v.board?.destroy(); v.board = null; v.boardScene = view.scene.id;
    if (s.board) v.board = createBoardView(overlay, s.board.items, { title: view.scene.title, text: k => ctx.text(k), reducedMotion: ctx.time.calm });
  }
  const who = (id: string) => { const c = v.director.lesson.cast.find(m => m.id === id); return c ? { name: ctx.text(c.name), color: c.color } : { name: id, color: undefined }; };
  const cap = view.timeline.caption ? { who: who(view.timeline.caption.who).name, text: view.timeline.caption.text, color: who(view.timeline.caption.who).color } : null;
  v.board?.update({ items: view.timeline.items, caption: cap, pointer: view.timeline.pointer });
  if (!v.board) captionLine(overlay, cap);
  if (v.sliderScene !== view.scene.id) {
    v.slider?.show(false); v.sliderScene = view.scene.id;
    if (view.sim) {
      v.slider = createSlider(overlay, { id: view.sim.id, label: view.sim.label, min: view.sim.min, max: view.sim.max, step: view.sim.step, value: view.sim.value, unit: '°' });
      v.slider.onInput(x => { v.param = x; });
    } else v.slider = null;
  }
  if (view.sim) v.slider?.set(Math.round(view.sim.value));
  const q = view.quiz, question = q ? v.director.scene.quiz?.questions[q.index] : undefined;
  // The quiz shows once the teacher has asked for answers (the timeline waits for them, or is over).
  const asking = !!q && !view.interrupt && (view.timeline.waiting?.event === 'answer' || view.timeline.done || q.state !== 'asking' || q.index > 0);
  v.quiz?.set(!asking ? null : q ? { prompt: q.prompt, options: q.options, hints: q.hints, feedback: q.feedback, state: q.state, chosen: q.chosen, answer: question?.answer, index: q.index, count: q.count } : null);
  v.controls?.set({
    progress: say(ctx, 'learn.step', { n: view.scene.index + 1, total: view.scene.count }),
    objectives: view.timeline.objectives && view.scene.index === 0 && view.timeline.waiting?.event === 'next' ? view.objectives.map(o => ({ text: o.text, met: o.met })) : null,
    objectivesTitle: say(ctx, 'learn.objectives'),
    can: { ...view.can, pause: !view.finished },
    paused: v.director.main.paused,
    labels: { next: say(ctx, 'learn.next'), back: say(ctx, 'learn.back'), again: say(ctx, 'learn.again'), hint: say(ctx, 'learn.hint'), question: say(ctx, 'learn.question'), pause: say(ctx, 'learn.pause'), play: say(ctx, 'learn.play'), finished: say(ctx, 'learn.finished'), controls: say(ctx, 'learn.controls') },
    finished: view.finished,
  });
}

/** A caption line for scenes without a board (sim, quiz): who speaks, what they say. */
const captions = new WeakMap<HTMLElement, { el: HTMLElement; last: string }>();
function captionLine(overlay: HTMLElement, cap: { who: string; text: string; color?: string } | null) {
  let c = captions.get(overlay);
  if (!c) {
    const el = overlay.ownerDocument.createElement('p'); el.setAttribute('aria-live', 'polite');
    el.style.cssText = 'position:absolute;left:50%;top:56px;transform:translateX(-50%);width:min(640px,calc(100% - 160px));margin:0;padding:6px 12px;border-radius:10px;background:rgb(10 16 22 / 78%);color:var(--engine-text);font:600 var(--engine-text-lg) var(--engine-font);text-align:center;';
    overlay.append(el); c = { el, last: '' }; captions.set(overlay, c);
  }
  const text = cap ? `${cap.who}: ${cap.text}` : '';
  if (text === c.last) return;
  c.last = text; c.el.textContent = text; c.el.style.display = cap ? '' : 'none'; c.el.style.borderLeft = cap?.color ? `6px solid ${cap.color}` : '';
}

/** The lesson's scene body: the director first, then the game's sim systems, then the concept explorer. */
export function lessonBody(lesson: Lesson | LessonInput, extra: SceneBody = {}, o: { provider?: DiscussProvider } = {}): SceneBody {
  return { entities: [...extra.entities ?? []], systems: [directorSystem(lesson, o), ...extra.systems ?? [], explorerSystem()] };
}
