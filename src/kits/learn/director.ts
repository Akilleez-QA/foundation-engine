/**
 * kits/learn/director: runs a lesson. It plays each scene's timeline, pauses it while the learner interacts or an
 * interrupt plays, and resumes after. Interrupts map to authored responses: "I have a question" plays the scene's
 * `interrupts.question`, "show again" replays the scene (or `interrupts.again`), "hint" shows the next quiz hint (or
 * `interrupts.hint`). Quiz answers get kind feedback; hints come before an answer is ever revealed. Sim parameters,
 * found parts, project milestones and discussions satisfy the timeline's gates and the lesson's checks. Progress
 * (scene, answers, objectives met) goes to a save handle. Pure: no DOM, no three.js; the runtime renders `view()`.
 */
import type { Action, Lesson, LessonScene } from './lesson';
import { TimelinePlayer, type TimelineState } from './timeline';
import { kidSafeProblems, type DiscussProvider } from './provider';

export interface LessonProgress { version: number; scene: number; answers: Record<string, string>; met: string[]; done: boolean }
export interface ProgressHandle { get(): LessonProgress | undefined; set(p: LessonProgress): void }
export interface DirectorOptions {
  text?: (key: string) => string;
  reducedMotion?: boolean;
  save?: ProgressHandle;
  provider?: DiscussProvider;
  /** Reject provider responses that fail the kid-safe check (the brief's kid-safe policy). */
  kidSafe?: boolean;
  /** Cues for feedback ('ui.success', 'ui.bump'). */
  cue?: (id: string) => void;
}

export interface QuizView { id: string; prompt: string; options: { id: string; text: string }[]; hints: string[]; feedback: string | null; state: 'asking' | 'right' | 'revealed'; index: number; count: number; chosen: string | null }
export interface LessonView {
  lesson: string; title: string;
  scene: { id: string; type: string; title: string; index: number; count: number };
  timeline: TimelineState;
  interrupt: boolean;
  quiz: QuizView | null;
  sim: { id: string; label: string; min: number; max: number; step: number; value: number } | null;
  explore: { parts: string[]; found: string[] } | null;
  project: { milestones: { id: string; text: string; done: boolean }[] } | null;
  discuss: { prompts: { id: string; text: string }[]; asked: string[] } | null;
  objectives: { id: string; text: string; met: boolean }[];
  can: { next: boolean; back: boolean; hint: boolean; question: boolean; again: boolean };
  finished: boolean;
}

export class LessonDirector {
  sceneIndex = 0;
  main!: TimelinePlayer;
  interrupt: TimelinePlayer | null = null;
  answers: Record<string, string> = {};
  params: Record<string, number> = {};
  met = new Set<string>();
  found = new Set<string>();
  milestones = new Set<string>();
  asked = new Set<string>();
  quiz = { index: 0, chosen: null as string | null, hints: 0, state: 'asking' as QuizView['state'], feedback: null as string | null };
  finished = false;
  private text: (k: string) => string;

  constructor(readonly lesson: Lesson, private o: DirectorOptions = {}) {
    this.text = o.text ?? (k => k);
    const saved = o.save?.get();
    if (saved && saved.version === lesson.version) {
      this.answers = { ...saved.answers }; for (const m of saved.met) this.met.add(m);
      this.sceneIndex = Math.min(saved.scene, lesson.outline.length - 1); this.finished = saved.done;
    }
    this.enter(this.sceneIndex);
  }

  /** The current outline item: sceneIndex stays within the outline, so only an empty outline has none. */
  private get item() { const item = this.lesson.outline[this.sceneIndex]; if (!item) throw Error('lesson: no outline item at the current scene'); return item; }
  get scene(): LessonScene { return this.lesson.scenes[this.item.id]!; } // a valid lesson has a scene per outline item
  private player(actions: readonly Action[]) { return new TimelinePlayer(actions, { text: this.text, reducedMotion: this.o.reducedMotion, answers: () => this.answers, params: () => this.params }); }
  private enter(i: number) {
    this.sceneIndex = i; this.interrupt = null;
    this.main = this.player(this.scene.timeline);
    this.quiz = { index: 0, chosen: null, hints: 0, state: 'asking', feedback: null };
    const sim = this.scene.sim; if (sim) this.params[sim.param.id] ??= sim.param.start;
    this.persist();
  }
  private persist() { this.o.save?.set({ version: this.lesson.version, scene: this.sceneIndex, answers: { ...this.answers }, met: [...this.met].sort(), done: this.finished }); }
  private gate(event: Parameters<TimelinePlayer['satisfy']>[0]) { this.main.satisfy(event); }

  /** Is the current scene's own work done (all questions, the sim check, parts, milestones, a discussion)? */
  sceneComplete(): boolean {
    const s = this.scene;
    if (s.quiz && this.quiz.index < s.quiz.questions.length) return false;
    if (s.sim && !s.sim.checks.every(c => (this.params[s.sim!.param.id] ?? -Infinity) >= c.atLeast)) return false;
    if (s.explore && !s.explore.parts.every(p => this.found.has(p))) return false;
    if (s.project && !s.project.milestones.every(m => this.milestones.has(m.id))) return false;
    if (s.discuss && !this.asked.size) return false;
    return this.main.done;
  }

  tick(dt: number) {
    if (this.interrupt) { this.interrupt.tick(dt); if (this.interrupt.done) { this.interrupt = null; this.main.resume(); } return; }
    this.main.tick(dt);
    // A gate the learner already satisfied (answered before the teacher asked) opens at once.
    const w = this.main.waiting;
    if (w && w.event !== 'next' && this.gateMet(w.event, w.min)) this.gate(w.event);
  }
  private gateMet(event: string, min?: number): boolean {
    const s = this.scene;
    switch (event) {
      case 'answer': return !!s.quiz && this.quiz.index >= s.quiz.questions.length;
      case 'param': return !!s.sim && (this.params[s.sim.param.id] ?? -Infinity) >= (min ?? Math.max(...s.sim.checks.map(c => c.atLeast), -Infinity));
      case 'part': return this.found.size >= (min ?? 1);
      case 'milestone': return this.milestones.size >= (min ?? 1);
      case 'discuss': return this.asked.size >= (min ?? 1);
      default: return false;
    }
  }

  /** Next: open a 'next' gate, else finish the timeline, else go to the next scene when this one is complete. */
  next(): void {
    if (this.interrupt) { this.interrupt = null; this.main.resume(); return; }
    if (this.main.waiting?.event === 'next') { this.gate('next'); if (!(this.main.done && this.sceneComplete())) return; }
    else if (this.main.time < this.main.limit - 1e-9) { this.main.skip(); return; }
    else if (this.quiz.state !== 'asking') { this.nextQuestion(); return; }
    if (!this.sceneComplete()) return;
    this.advance();
  }
  private advance(): void {
    if (this.sceneIndex + 1 < this.lesson.outline.length) this.enter(this.sceneIndex + 1);
    else { this.finished = true; this.persist(); }
  }
  back(): void { if (this.sceneIndex > 0) this.enter(this.sceneIndex - 1); }
  pause(): void { this.main.pause(); }
  resume(): void { this.main.resume(); }
  again(): void {
    const a = this.scene.interrupts?.again;
    if (a) { this.main.pause(); this.interrupt = this.player(a); } else this.main.again();
  }
  question(): void {
    const q = this.scene.interrupts?.question;
    if (!q) return;
    this.main.pause(); this.interrupt = this.player(q);
  }
  hint(): void {
    const s = this.scene, q = s.quiz?.questions[this.quiz.index];
    if (q && this.quiz.state === 'asking') { if (this.quiz.hints < q.hints.length) this.quiz.hints++; return; }
    const h = s.interrupts?.hint;
    if (h) { this.main.pause(); this.interrupt = this.player(h); }
  }

  /** Answer the current quiz question. Wrong: kind feedback and the next hint; the answer is revealed only after every hint. */
  answer(option: string): void {
    const q = this.scene.quiz?.questions[this.quiz.index];
    if (!q || this.quiz.state !== 'asking') return;
    this.quiz.chosen = option;
    this.answers[q.id] = option;
    if (option === q.answer) {
      this.quiz.state = 'right'; this.quiz.feedback = this.text(q.feedback.right); this.met.add(q.objective); this.o.cue?.('ui.success');
    } else if (this.quiz.hints < q.hints.length) {
      this.quiz.hints++; this.quiz.feedback = this.text(q.feedback.retry); this.o.cue?.('ui.bump');
    } else {
      this.quiz.state = 'revealed'; this.quiz.feedback = this.text(q.feedback.retry);
    }
    this.persist();
  }
  /** After feedback: the next question (or the quiz is complete). */
  nextQuestion(): void {
    const qs = this.scene.quiz?.questions ?? [];
    if (this.quiz.state === 'asking') return;
    this.quiz = { index: this.quiz.index + 1, chosen: null, hints: 0, state: 'asking', feedback: null };
    if (this.quiz.index >= qs.length) this.gate('answer');
  }
  setParam(value: number): void {
    const sim = this.scene.sim; if (!sim) return;
    const v = Math.max(sim.param.min, Math.min(sim.param.max, value));
    this.params[sim.param.id] = v;
    for (const c of sim.checks) if (v >= c.atLeast) this.met.add(c.objective);
  }
  findPart(id: string): void {
    const e = this.scene.explore; if (!e?.parts.includes(id) || this.found.has(id)) return;
    this.found.add(id);
    for (const c of e.checks) if (c.part === id) this.met.add(c.objective);
  }
  completeMilestone(id: string): void {
    const m = this.scene.project?.milestones.find(x => x.id === id); if (!m) return;
    this.milestones.add(id); this.met.add(m.objective); this.persist();
  }
  async discuss(prompt: string): Promise<void> {
    const s = this.scene; if (!s.discuss?.prompts.some(p => p.id === prompt)) return;
    let response = this.o.provider ? await this.o.provider.respond(prompt, { lesson: this.lesson.id, scene: this.item.id, text: this.text }) : [];
    if (this.o.kidSafe && kidSafeProblems(response, this.text).length) response = [];
    this.asked.add(prompt);
    this.main.pause(); this.interrupt = this.player(response.length ? response : s.interrupts?.question ?? []);
  }

  view(): LessonView {
    const s = this.scene, item = this.item, t = (this.interrupt ?? this.main).state();
    const q = s.quiz?.questions[this.quiz.index];
    const complete = this.sceneComplete();
    return {
      lesson: this.lesson.id, title: this.text(this.lesson.title),
      scene: { id: item.id, type: s.type, title: this.text(s.title), index: this.sceneIndex, count: this.lesson.outline.length },
      timeline: t, interrupt: !!this.interrupt,
      quiz: q ? { id: q.id, prompt: this.text(q.prompt), options: q.options.map(o => ({ id: o.id, text: this.text(o.text) })), hints: q.hints.slice(0, this.quiz.hints).map(this.text), feedback: this.quiz.feedback, state: this.quiz.state, index: this.quiz.index, count: s.quiz!.questions.length, chosen: this.quiz.chosen } : null,
      sim: s.sim ? { id: s.sim.param.id, label: this.text(s.sim.param.label), min: s.sim.param.min, max: s.sim.param.max, step: s.sim.param.step, value: this.params[s.sim.param.id] ?? s.sim.param.start } : null,
      explore: s.explore ? { parts: s.explore.parts, found: [...this.found] } : null,
      project: s.project ? { milestones: s.project.milestones.map(m => ({ id: m.id, text: this.text(m.text), done: this.milestones.has(m.id) })) } : null,
      discuss: s.discuss ? { prompts: s.discuss.prompts.map(p => ({ id: p.id, text: this.text(p.text) })), asked: [...this.asked] } : null,
      objectives: this.lesson.objectives.map(ob => ({ id: ob.id, text: this.text(ob.text), met: this.met.has(ob.id) })),
      can: {
        next: !this.finished && (!!this.interrupt || this.main.waiting?.event === 'next' || this.main.time < this.main.limit - 1e-9 || complete || this.quiz.state !== 'asking'),
        back: this.sceneIndex > 0, hint: !!(q && this.quiz.state === 'asking' && this.quiz.hints < q.hints.length) || !!s.interrupts?.hint,
        question: !!s.interrupts?.question, again: true,
      },
      finished: this.finished,
    };
  }
}
