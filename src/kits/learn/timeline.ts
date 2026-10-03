/**
 * kits/learn/timeline: a lesson scene's action timeline, played deterministically.
 *
 * Actions take fixed durations (a line of speech by its word count, a drawing 1.2 s, …; drawings and camera moves
 * take no time under reduced motion). `wait-for` is a gate: time stops there until the learner does the thing it
 * waits for. A `branch` is decided when the timeline reaches it, from the answers and parameters at that moment, and
 * never changes afterwards. The state at time t is a pure function of the resolved steps, so the timeline can be
 * paused, scrubbed back, replayed ("show again") and skipped to the next gate.
 */
import type {Action, CastId} from './lesson';

export interface Step {
  action: Action;
  start: number;
  end: number;
  gate?: {satisfied: boolean};
}
export interface ItemState {
  visible: boolean;
  progress: number;
  spotlight: boolean;
}
export interface TimelineState {
  time: number;
  items: Record<string, ItemState>;
  caption: {who: CastId; text: string} | null;
  pointer: string | null;
  spotlight: string | null;
  camera: {yaw?: number; pitch?: number; distance?: number} | null;
  /** The objectives card is up: from an `objectives` action until the learner passes the next gate after it. */
  objectives: boolean;
  waiting: Extract<Action, {do: 'wait-for'}> | null;
  done: boolean;
}
export interface TimelineOptions {
  text?: (key: string) => string;
  reducedMotion?: boolean | undefined;
  answers?: () => Readonly<Record<string, string>>;
  params?: () => Readonly<Record<string, number>>;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
export function durationOf(a: Action, o: TimelineOptions = {}): number {
  const calm = !!o.reducedMotion;
  switch (a.do) {
    case 'say':
      return Math.max(1.2, words(o.text?.(a.text) ?? a.text) * 0.32);
    case 'objectives':
      return 2;
    case 'draw':
      return calm ? 0 : 1.2;
    case 'write':
      return calm ? 0 : 0.8;
    case 'camera':
      return calm ? 0 : 1;
    case 'reveal':
    case 'hide':
    case 'spotlight':
    case 'point':
      return 0.3;
    default:
      return 0;
  }
}

export class TimelinePlayer {
  readonly steps: Step[] = [];
  time = 0;
  paused = false;
  private queue: Action[];
  private cursor = 0;
  constructor(
    actions: readonly Action[],
    private o: TimelineOptions = {},
  ) {
    this.queue = [...actions];
    this.extend();
  }

  /** Resolve actions up to and including the next gate. */
  private extend() {
    while (this.queue.length) {
      const a = this.queue.shift()!;
      if (a.do === 'branch') {
        const c = a.if,
          answers = this.o.answers?.() ?? {},
          params = this.o.params?.() ?? {};
        const yes = 'answer' in c ? answers[c.answer] === c.is : (params[c.param] ?? -Infinity) >= c.atLeast;
        this.queue.unshift(...(yes ? a.then : (a.else ?? [])));
        continue;
      }
      const d = durationOf(a, this.o);
      const step: Step = {action: a, start: this.cursor, end: this.cursor + d};
      this.cursor = step.end;
      if (a.do === 'wait-for') {
        step.gate = {satisfied: false};
        this.steps.push(step);
        return;
      }
      this.steps.push(step);
    }
  }
  /** The time the player may not pass: the first unsatisfied gate, or the end. */
  get limit(): number {
    return this.steps.find(s => s.gate && !s.gate.satisfied)?.start ?? this.cursor;
  }
  get end(): number {
    return this.cursor;
  }
  get waiting(): Extract<Action, {do: 'wait-for'}> | null {
    const g = this.steps.find(s => s.gate && !s.gate.satisfied);
    return g && this.time >= g.start - 1e-9 ? (g.action as Extract<Action, {do: 'wait-for'}>) : null;
  }
  get done(): boolean {
    return !this.queue.length && this.steps.every(s => !s.gate || s.gate.satisfied) && this.time >= this.cursor - 1e-9;
  }

  tick(dt: number) {
    if (!this.paused && dt > 0) this.time = Math.min(this.time + dt, this.limit);
  }
  /** The learner did what the current gate waits for. False when nothing waits for it yet. */
  satisfy(event: Extract<Action, {do: 'wait-for'}>['event']): boolean {
    const w = this.waiting;
    if (!w || w.event !== event) return false;
    this.steps.find(s => s.gate && !s.gate.satisfied)!.gate!.satisfied = true;
    this.extend();
    return true;
  }
  /** Jump to the next gate (or the end). */
  skip() {
    this.time = this.limit;
  }
  scrub(t: number) {
    this.time = Math.max(0, Math.min(t, this.limit));
  }
  /** Show again: replay from the start; gates already passed stay passed. */
  again() {
    this.time = 0;
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }

  state(): TimelineState {
    const t = this.time,
      items: Record<string, ItemState> = {};
    let caption: TimelineState['caption'] = null,
      pointer: string | null = null,
      spotlight: string | null = null,
      camera: TimelineState['camera'] = null,
      objectives = false;
    const item = (id: string) => (items[id] ??= {visible: false, progress: 0, spotlight: false});
    for (const s of this.steps) {
      if (s.start > t + 1e-9) break;
      const p = s.end > s.start ? Math.min(1, (t - s.start) / (s.end - s.start)) : 1;
      const a = s.action;
      switch (a.do) {
        case 'say':
          caption = {who: a.who, text: this.o.text?.(a.text) ?? a.text};
          break;
        case 'objectives':
          objectives = true;
          break;
        // Passing a gate after the objectives puts the card away; it never comes back over later drawings.
        case 'wait-for':
          if (s.gate?.satisfied) objectives = false;
          break;
        case 'draw':
        case 'write':
          Object.assign(item(a.target), {visible: true, progress: p});
          break;
        case 'reveal':
          Object.assign(item(a.target), {visible: true, progress: 1});
          break;
        case 'hide':
          item(a.target).visible = false;
          break;
        case 'spotlight':
          spotlight = a.target;
          break;
        case 'point':
          pointer = a.target;
          break;
        case 'camera':
          camera = {
            ...(camera ?? {}),
            ...(a.yaw !== undefined ? {yaw: a.yaw} : {}),
            ...(a.pitch !== undefined ? {pitch: a.pitch} : {}),
            ...(a.distance !== undefined ? {distance: a.distance} : {}),
          };
          break;
      }
    }
    if (spotlight) item(spotlight).spotlight = true;
    return {time: t, items, caption, pointer, spotlight, camera, objectives, waiting: this.waiting, done: this.done};
  }
}
