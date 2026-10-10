/**
 * Branching sequences: a graph of sequence definitions joined at held "branch" cues.
 *
 * Each node is a sequence definition. A branch names a held cue in its node and maps creator choice ids to the next
 * node (or `null` to end). When that cue is active and waiting, `choose(choice)` ends the current run at that point:
 * effects already returned stay landed, effects after the branch cue are abandoned (never returned), and the chosen
 * node starts as a new run with its own session `<session>#<step>`, so exactly-once effect ids stay distinct per step.
 * `skip()` follows each branch's `default` choice: a node with a branch lands the skip effects of the incomplete cues
 * its branch cue depends on and abandons the rest; a node without a branch is skipped whole. Reaching `maxSteps` ends
 * the graph and sets `limited` instead of throwing.
 * Snapshots hold the node, step and the current run's snapshot for one save section.
 */
import {
  createSequence,
  parseSequenceState,
  type AdvanceResult,
  type SequenceCue,
  type SequenceDefinition,
  type SequenceEvent,
  type SequenceRunner,
  type SequenceState,
} from './sequence';

export interface SequenceBranch {
  /** Node the branch belongs to. */
  readonly node: string;
  /** A held cue (`hold: true`) of that node's definition. */
  readonly at: string;
  /** Choice id → next node, or null to end the graph. 1-16 choices. */
  readonly choices: Readonly<Record<string, string | null>>;
  /** Choice followed by `skip()`. */
  readonly default: string;
}
export interface SequenceGraphInput {
  readonly id: string;
  readonly start: string;
  /** Node id → definition, 1-64 nodes. */
  readonly nodes: Readonly<Record<string, SequenceDefinition>>;
  readonly branches?: readonly SequenceBranch[];
  /** Longest run of nodes one graph session may play (cycles allowed), default 64, max 1,024. */
  readonly maxSteps?: number;
}
export interface SequenceGraphState {
  readonly version: 1;
  readonly graph: string;
  readonly session: string;
  readonly node: string | null;
  readonly step: number;
  readonly run: SequenceState | null;
  readonly status: 'running' | 'finished' | 'skipped' | 'cancelled';
}
export const GRAPH_LIMITS = Object.freeze({nodes: 64, choices: 16, maxSteps: 1024});

function fail(message: string): never {
  throw new RangeError(`sequence graph: ${message}`);
}
const isId = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 256;

export function defineSequenceGraph(input: SequenceGraphInput) {
  if (!input || typeof input !== 'object') fail('definition must be an object');
  const id = input.id,
    start = input.start,
    nodesIn = input.nodes,
    branchesIn = input.branches ?? [],
    maxSteps = input.maxSteps ?? 64;
  if (!isId(id)) fail('graph id must be 1-256 characters');
  if (!nodesIn || typeof nodesIn !== 'object') fail('nodes must be an object');
  const names = Object.keys(nodesIn);
  if (names.length < 1 || names.length > GRAPH_LIMITS.nodes) fail(`a graph has 1-${GRAPH_LIMITS.nodes} nodes`);
  const nodes = new Map<string, SequenceDefinition>();
  for (const name of names) {
    const d = (nodesIn as Record<string, SequenceDefinition>)[name];
    if (!isId(name) || !d || typeof d.fingerprint !== 'string' || !Object.isFrozen(d))
      fail(`node ${name}: use defineSequence for node definitions`);
    nodes.set(name, d);
  }
  if (!isId(start) || !nodes.has(start)) fail('start must name a node');
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > GRAPH_LIMITS.maxSteps)
    fail(`maxSteps must be an integer in [1, ${GRAPH_LIMITS.maxSteps}]`);
  if (!Array.isArray(branchesIn)) fail('branches must be an array');
  const branches = new Map<string, SequenceBranch>();
  for (let i = 0; i < branchesIn.length; i++) {
    const b = (branchesIn as readonly SequenceBranch[])[i];
    if (!b || typeof b !== 'object') fail('a branch must be an object');
    const node = b.node,
      at = b.at,
      choicesIn = b.choices,
      dflt = b.default;
    const def = nodes.get(node);
    if (!def) fail(`branch names unknown node ${String(node)}`);
    if (branches.has(node)) fail(`node ${node} has more than one branch`);
    const cue = def.tracks.flatMap(t => t.cues).find(c => c.id === at);
    if (!cue || !cue.hold) fail(`branch ${node}: ${String(at)} must be a held cue of that node`);
    if (!choicesIn || typeof choicesIn !== 'object') fail(`branch ${node}: choices must be an object`);
    const keys = Object.keys(choicesIn);
    if (keys.length < 1 || keys.length > GRAPH_LIMITS.choices) fail(`branch ${node}: 1-16 choices`);
    const choices: Record<string, string | null> = Object.create(null);
    for (const k of keys) {
      const target: unknown = (choicesIn as Record<string, unknown>)[k];
      if (!isId(k) || (target !== null && (!isId(target) || !nodes.has(target))))
        fail(`branch ${node}: choice ${k} must lead to a node or null`);
      choices[k] = target as string | null;
    }
    if (!isId(dflt) || !Object.hasOwn(choices, dflt)) fail(`branch ${node}: default must be one of its choices`);
    branches.set(node, Object.freeze({node, at, choices: Object.freeze(choices), default: dflt}));
  }
  return Object.freeze({id, start, nodes, branches, maxSteps});
}
export type SequenceGraph = ReturnType<typeof defineSequenceGraph>;

export function parseSequenceGraphState(graph: SequenceGraph, raw: unknown): SequenceGraphState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype)
    fail('state must be a plain object');
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).sort().join() !== 'graph,node,run,session,status,step,version')
    fail('state has unexpected fields');
  const version = r.version,
    gid = r.graph,
    session = r.session,
    node = r.node,
    step = r.step,
    run = r.run,
    status = r.status;
  if (version !== 1 || gid !== graph.id) fail('state belongs to another graph');
  if (!isId(session)) fail('invalid session');
  if (!['running', 'finished', 'skipped', 'cancelled'].includes(status as string)) fail('invalid status');
  if (!Number.isSafeInteger(step) || (step as number) < 0 || (step as number) >= graph.maxSteps) fail('invalid step');
  if (status === 'running') {
    if (!isId(node) || !graph.nodes.has(node)) fail('a running state names a node');
    if (step === 0 && node !== graph.start) fail('step 0 must be the start node');
    if (run === null) fail('a running state has a run');
    const parsed = parseSequenceState(graph.nodes.get(node)!, run);
    if (parsed.session !== `${session}#${step}`) fail('run session does not match the graph step');
    if (parsed.status !== 'running') fail('a running graph has a running node');
    return Object.freeze({version: 1, graph: graph.id, session, node, step: step as number, run: parsed, status});
  }
  if (node !== null || run !== null) fail('a stopped graph has no node or run');
  return Object.freeze({
    version: 1,
    graph: graph.id,
    session,
    node: null,
    step: step as number,
    run: null,
    status: status as SequenceGraphState['status'],
  });
}

/** Cues the given cue waits for, transitively (track predecessors and barriers), in definition order. */
function ancestors(def: SequenceDefinition, cueId: string): SequenceCue[] {
  const where = new Map<string, {track: number; index: number}>();
  def.tracks.forEach((t, ti) => t.cues.forEach((c, ci) => where.set(c.id, {track: ti, index: ci})));
  const need = new Set<string>(),
    stack = [cueId];
  while (stack.length) {
    const id = stack.pop()!;
    const p = where.get(id)!,
      cue = def.tracks[p.track]!.cues[p.index]!;
    const deps = [...(cue.after ?? []), ...(p.index > 0 ? [def.tracks[p.track]!.cues[p.index - 1]!.id] : [])];
    for (const d of deps)
      if (!need.has(d)) {
        need.add(d);
        stack.push(d);
      }
  }
  return def.tracks.flatMap(t => t.cues).filter(c => need.has(c.id));
}

export function createSequenceGraph(
  graph: SequenceGraph,
  session: string,
  restored?: SequenceGraphState | null,
  options: {readonly maxTransitions?: number} = {},
) {
  if (!graph || !(graph.nodes instanceof Map)) fail('use defineSequenceGraph');
  if (!isId(session) || session.includes('#')) fail('session must be 1-256 characters without #');
  const start = restored ? parseSequenceGraphState(graph, restored) : null;
  if (start && start.session !== session) fail('state belongs to another session');
  let node: string | null = start ? start.node : graph.start,
    step = start?.step ?? 0,
    status: SequenceGraphState['status'] = start?.status ?? 'running';
  const runOf = (name: string, s: number, state?: SequenceState | null): SequenceRunner =>
    createSequence(graph.nodes.get(name)!, `${session}#${s}`, state, options);
  let run: SequenceRunner | null = node === null ? null : runOf(node, step, start?.run);

  let limited = false;
  /** Move to `next`; at the step bound the graph ends (with `limited`) instead of starting another node. */
  const enter = (next: string | null, events: SequenceEvent[], announce: boolean) => {
    const tick = run?.tick ?? 0;
    if (next !== null && step + 1 >= graph.maxSteps) limited = true;
    if (next === null || limited) {
      node = null;
      run = null;
      status = 'finished';
      if (announce) events.push(Object.freeze({kind: 'finished', tick}));
      return;
    }
    step++;
    node = next;
    run = runOf(next, step);
  };
  const offered = (): readonly string[] | null => {
    if (status !== 'running' || !run || node === null || !run.settled) return null;
    const b = graph.branches.get(node);
    if (!b) return null;
    const current = run;
    const active = current.definition.tracks.map(t => current.active(t.id)).find(a => a?.cue === b.at);
    return active?.waiting ? Object.freeze(Object.keys(b.choices)) : null;
  };
  return {
    graph,
    session,
    get node() {
      return node;
    },
    get step() {
      return step;
    },
    get status() {
      return status;
    },
    /** True when the graph ended because `maxSteps` was reached rather than by a `null` choice or a final node. */
    get limited() {
      return limited;
    },
    /** The current node's runner (for `active`, `release`, `settled`), or null when stopped. */
    get run(): SequenceRunner | null {
      return run;
    },
    /**
     * Advance the current node. A node that finishes without a branch ends the graph. Ticks left over when a node
     * changes are not carried into the next node; the next node starts on the following advance.
     */
    advance(ticks: number): AdvanceResult & {readonly node: string | null} {
      if (status !== 'running' || !run) return Object.freeze({status, events: Object.freeze([]), node});
      const r = run.advance(ticks);
      const events = [...r.events];
      if (run.status === 'finished') {
        // A node without a branch ends the graph. A branch node only finishes if its held branch cue was released
        // directly; that follows the branch default. The node already reported 'finished'.
        const b = graph.branches.get(node!);
        if (!b) {
          node = null;
          run = null;
          status = 'finished';
        } else enter(b.choices[b.default]!, events, false);
      }
      return Object.freeze({status: r.status === 'partial' ? 'partial' : status, events: Object.freeze(events), node});
    },
    /** The choices offered now (branch cue active and waiting, and the run settled), or null. */
    offered,
    /**
     * Take a branch while it is offered. Cancels the rest of the current node at this moment (its incomplete cues,
     * including parallel ones and the branch cue's own effect, never land) and starts the chosen node, or ends the
     * graph. At the step bound the graph ends instead (`limited`). Returns 'not-offered' otherwise.
     */
    choose(choice: string): {readonly status: 'chosen' | 'not-offered'; readonly events: readonly SequenceEvent[]} {
      const choices = offered();
      if (!choices) return Object.freeze({status: 'not-offered', events: Object.freeze([])});
      if (!choices.includes(choice)) fail(`unknown choice ${String(choice)}`);
      const b = graph.branches.get(node!)!;
      const target = b.choices[choice]!;
      const events: SequenceEvent[] = [];
      run!.cancel();
      enter(target, events, true);
      return Object.freeze({status: 'chosen', events: Object.freeze(events)});
    },
    /**
     * Skip the remaining graph, following each branch's default. A branch node lands the skip effects of the
     * incomplete cues its branch cue depends on (track predecessors and barriers, transitively) and abandons the rest,
     * including parallel cues that time alone would have completed first. A node without a branch is skipped whole.
     * Stops with status 'partial' at a node that is not skippable; ends (`limited`) at the step bound.
     */
    skip(): {
      readonly status: 'skipped' | 'partial' | 'refused' | 'inactive';
      readonly events: readonly SequenceEvent[];
    } {
      if (status !== 'running' || !run) return Object.freeze({status: 'inactive', events: Object.freeze([])});
      if (!run.definition.skippable) return Object.freeze({status: 'refused', events: Object.freeze([])});
      const events: SequenceEvent[] = [];
      while (run) {
        const name: string = node!;
        if (!run.definition.skippable) return Object.freeze({status: 'partial', events: Object.freeze(events)});
        const b = graph.branches.get(name);
        if (!b) {
          events.push(...run.skip().events);
          node = null;
          run = null;
          break;
        }
        const current = run;
        for (const cue of ancestors(current.definition, b.at)) {
          if (current.completed(cue.id) || cue.effect === undefined || cue.onSkip === 'drop') continue;
          events.push(
            Object.freeze({
              kind: 'effect',
              effect: cue.effect,
              cue: cue.id,
              id: JSON.stringify([current.definition.id, current.session, cue.id]),
              tick: current.tick,
            }),
          );
        }
        current.cancel();
        const next = b.choices[b.default]!;
        if (next === null) {
          node = null;
          run = null;
          break;
        }
        if (step + 1 >= graph.maxSteps) {
          limited = true;
          node = null;
          run = null;
          break;
        }
        step++;
        node = next;
        run = runOf(next, step);
      }
      status = 'skipped';
      return Object.freeze({status: 'skipped', events: Object.freeze(events)});
    },
    cancel(): void {
      if (status !== 'running') return;
      run?.cancel();
      run = null;
      node = null;
      status = 'cancelled';
    },
    snapshot(): SequenceGraphState {
      return parseSequenceGraphState(graph, {
        version: 1,
        graph: graph.id,
        session,
        node: status === 'running' ? node : null,
        step,
        run: status === 'running' && run ? run.snapshot() : null,
        status,
      });
    },
  };
}
export type SequenceGraphRunner = ReturnType<typeof createSequenceGraph>;
