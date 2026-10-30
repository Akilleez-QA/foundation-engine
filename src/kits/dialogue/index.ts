import {defineKit} from '../../author';
import {
  checkConditions,
  DIALOGUE_LIMITS,
  evaluate,
  applyAssignments,
  initialVariables,
  restoreVariables,
  type DialogueAssignment,
  type DialogueCondition,
  type DialogueValue,
  type DialogueVariables,
} from './conditions';

export {
  DIALOGUE_LIMITS,
  type DialogueAssignment,
  type DialogueCondition,
  type DialogueValue,
  type DialogueVariables,
} from './conditions';

export interface DialogueOption {
  id: string;
  text: string;
  to: string | null;
  /** Caller facts that must all be present (unchanged from the first version). */
  requires?: readonly string[];
  effects?: readonly string[];
  /** Optional bounded condition over declared variables, visit counts and caller facts. */
  when?: DialogueCondition;
  /** Optional variable changes applied atomically with the move when this option is chosen. */
  set?: readonly DialogueAssignment[];
}
export interface DialogueNode {
  id: string;
  text: string;
  options: readonly DialogueOption[];
}
export interface DialogueDefinition {
  id: string;
  start: string;
  nodes: readonly DialogueNode[];
  /** Optional declared variables with their initial values; each keeps its type (boolean, safe integer or string). */
  variables?: Readonly<Record<string, DialogueValue>>;
}
/**
 * Plain data for a save section. `variables` and `visits` are absent in snapshots from the first version; restoring
 * such a snapshot starts every variable at its initial value and counts one visit to the current node.
 */
export interface DialogueState {
  definition: string;
  session: string;
  node: string | null;
  revision: number;
  variables?: DialogueVariables;
  /** Times each node has been entered in this session (the start node counts once). Saturates at MAX_SAFE_INTEGER. */
  visits?: Readonly<Record<string, number>>;
}
export type DialogueChoice =
  {status: 'applied'; effects: string[]} | {status: 'stale' | 'unavailable' | 'closed' | 'overflow'};

/** String fields are localization keys. Effects are intents for the game's authoritative reducer. */
export function createDialogue(definition: DialogueDefinition, session: string, restored?: DialogueState) {
  const validId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;
  const d = structuredClone(definition),
    nodes = new Map(d.nodes.map(n => [n.id, n]));
  if (
    !validId(d.id) ||
    !validId(session) ||
    nodes.size !== d.nodes.length ||
    !nodes.has(d.start) ||
    nodes.size > DIALOGUE_LIMITS.maxNodes
  )
    throw Error('dialogue: invalid definition');
  const declared = initialVariables(d.variables);
  for (const n of d.nodes) {
    if (
      !validId(n.id) ||
      !validId(n.text) ||
      !Array.isArray(n.options) ||
      n.options.length > DIALOGUE_LIMITS.maxOptions ||
      new Set(n.options.map(o => o.id)).size !== n.options.length
    )
      throw Error('dialogue: invalid node');
    for (const o of n.options) {
      if (
        (o.requires !== undefined && !Array.isArray(o.requires)) ||
        (o.effects !== undefined && !Array.isArray(o.effects))
      )
        throw Error('dialogue: invalid option');
      if (
        !validId(o.id) ||
        !validId(o.text) ||
        (o.to !== null && !nodes.has(o.to)) ||
        (o.requires ?? []).length > 1024 ||
        (o.effects ?? []).length > 1024 ||
        (o.requires ?? []).some((x: unknown) => !validId(x)) ||
        (o.effects ?? []).some((x: unknown) => !validId(x))
      )
        throw Error('dialogue: invalid option');
      checkConditions(o.when, o.set, declared, nodes);
    }
  }
  // Every node must have an authored route to an exit, independently of runtime fact or variable values.
  const exits = new Set(d.nodes.filter(n => n.options.some(o => o.to === null) || !n.options.length).map(n => n.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const n of d.nodes)
      if (!exits.has(n.id) && n.options.some(o => o.to !== null && exits.has(o.to))) {
        exits.add(n.id);
        changed = true;
      }
  }
  if (exits.size !== nodes.size) throw Error('dialogue: graph has no exit');

  type Live = {
    definition: string;
    session: string;
    node: string | null;
    revision: number;
    variables: DialogueVariables;
    visits: Record<string, number>;
  };
  let state: Live;
  if (restored) {
    const r = structuredClone(restored);
    if (
      !r ||
      r.definition !== d.id ||
      r.session !== session ||
      (r.node !== null && !nodes.has(r.node)) ||
      !Number.isSafeInteger(r.revision) ||
      r.revision < 0
    )
      throw Error('dialogue: invalid snapshot');
    const visits: Record<string, number> = Object.create(null);
    if (r.visits === undefined) {
      if (r.node !== null) visits[r.node] = 1;
    } else {
      if (!r.visits || typeof r.visits !== 'object' || Array.isArray(r.visits))
        throw Error('dialogue: invalid snapshot visits');
      for (const [k, v] of Object.entries(r.visits)) {
        if (!nodes.has(k) || !Number.isSafeInteger(v) || v < 0) throw Error('dialogue: invalid snapshot visits');
        visits[k] = v;
      }
    }
    if (r.node !== null && !((visits[r.node] ?? 0) >= 1)) throw Error('dialogue: invalid snapshot visits');
    state = {
      definition: d.id,
      session,
      node: r.node,
      revision: r.revision,
      variables: restoreVariables(declared, r.variables),
      visits,
    };
  } else {
    const visits: Record<string, number> = Object.create(null);
    visits[d.start] = 1;
    state = {definition: d.id, session, node: d.start, revision: 0, variables: declared, visits};
  }
  const visitsOf = (id: string) => state.visits[id] ?? 0;
  const allowed = (o: DialogueOption, facts: ReadonlySet<string>) =>
    (o.requires ?? []).every(f => facts.has(f)) &&
    (o.when === undefined || evaluate(o.when, {variables: state.variables, visits: visitsOf, facts}));
  const snapshot = (): DialogueState => {
    // fromEntries defines own properties, so a node id such as `__proto__` keeps its count.
    const visits: Record<string, number> = Object.fromEntries(
      Object.keys(state.visits)
        .sort()
        .map(k => [k, state.visits[k]!]),
    ); // k is an own key
    return {
      definition: state.definition,
      session: state.session,
      node: state.node,
      revision: state.revision,
      variables: {...state.variables},
      visits,
    };
  };
  return {
    snapshot,
    /** Current variable values (a copy), e.g. as message variables for `ctx.text`. */
    variables: (): DialogueVariables => ({...state.variables}),
    /** Times a node has been entered in this session; 0 for unknown or unvisited nodes. */
    visits: (node: string): number => (nodes.has(node) ? visitsOf(node) : 0),
    view(facts: ReadonlySet<string>) {
      if (state.node === null) return null;
      const n = nodes.get(state.node)!;
      return {
        session,
        revision: state.revision,
        node: n.id,
        text: n.text,
        variables: {...state.variables},
        options: n.options.filter(o => allowed(o, facts)).map(o => ({id: o.id, text: o.text})),
      };
    },
    choose(
      request: {session: string; revision: number; node: string; option: string},
      facts: ReadonlySet<string>,
    ): DialogueChoice {
      if (state.node === null) return {status: 'closed'};
      if (request.session !== session || request.revision !== state.revision || request.node !== state.node)
        return {status: 'stale'};
      const before = state;
      const o = nodes.get(state.node)!.options.find(o => o.id === request.option);
      if (!o || !allowed(o, facts))
        return state !== before ? {status: state.node === null ? 'closed' : 'stale'} : {status: 'unavailable'};
      if (state !== before) return {status: state.node === null ? 'closed' : 'stale'};
      if (state.revision === Number.MAX_SAFE_INTEGER) throw Error('dialogue: revision exhausted');
      const variables = applyAssignments(state.variables, o.set);
      if (variables === null) return {status: 'overflow'};
      const visits = state.visits;
      if (o.to !== null) {
        const next: Record<string, number> = Object.assign(Object.create(null), visits);
        next[o.to] = Math.min(Number.MAX_SAFE_INTEGER, (visits[o.to] ?? 0) + 1);
        state = {...state, node: o.to, revision: state.revision + 1, variables, visits: next};
      } else state = {...state, node: null, revision: state.revision + 1, variables};
      return {status: 'applied', effects: [...(o.effects ?? [])]};
    },
    close() {
      if (state.node !== null) {
        if (state.revision === Number.MAX_SAFE_INTEGER) throw Error('dialogue: revision exhausted');
        state = {...state, node: null, revision: state.revision + 1};
      }
    },
  };
}
export const dialogue = () => defineKit({id: 'dialogue'});
