import {createDialogue, type DialogueDefinition, type DialogueState} from '../../src/kits/dialogue/index';
import {createInventoryLedger, type InventorySnapshot} from '../../src/kits/inventory/ledger';
import {createObjectiveRun, type ObjectiveSnapshot} from '../../src/kits/objectives/run';
import type {SaveSection, SaveStore} from '../../src/core/save/section';

export type Consumer = 'reward' | 'unlock';
interface Intent {
  id: string;
  delivered: boolean;
  acknowledged: boolean;
}
export interface Envelope {
  version: 1;
  consumer: Consumer;
  choices: string[];
  dialogue: DialogueState;
  intents: Intent[];
  inventory: InventorySnapshot;
  objective: ObjectiveSnapshot;
}
export interface Ticket {
  readonly id: string;
}
export type Result = 'saved' | 'save-failed' | 'stale' | 'refused' | 'saturated' | 'blocked' | 'closed';

/** Creator-owned lab adapter. No exported kit or general quest interpreter. */
export function fixture(consumer: Consumer, maxIntents = 4, capacity = 8) {
  if (
    !['reward', 'unlock'].includes(consumer) ||
    !Number.isSafeInteger(maxIntents) ||
    maxIntents < 1 ||
    maxIntents > 8 ||
    !Number.isSafeInteger(capacity) ||
    capacity < 0 ||
    capacity > 8
  )
    throw Error('invalid fixture options');
  const session = `visit-${consumer}`;
  const definition: DialogueDefinition = {
    id: consumer,
    start: 'offer',
    nodes: [
      {
        id: 'offer',
        text: 'offer',
        options: [
          {id: 'accept', text: 'accept', to: consumer === 'reward' ? 'offer' : null, effects: [consumer]},
          {id: 'leave', text: 'leave', to: null},
        ],
      },
    ],
  };
  const inventoryOptions = {capacities: {bag: capacity}, maxOperations: maxIntents};
  const objectiveOptions = {
    runId: session,
    maxEvents: maxIntents,
    requirements: [{id: 'access', event: 'unlock', target: 1}],
  };
  const item = {id: 'reward', material: 'token', properties: {}};
  const inventory = (saved?: unknown) => createInventoryLedger(inventoryOptions, saved);
  const objective = (saved?: unknown) => createObjectiveRun(objectiveOptions, saved);
  const initial = (): Envelope => ({
    version: 1,
    consumer,
    choices: [],
    intents: [],
    dialogue: createDialogue(definition, session).snapshot(),
    inventory: inventory().snapshot(),
    objective: objective().snapshot(),
  });
  const sink = (state: Envelope, id: string) => {
    if (consumer === 'reward') {
      const ledger = inventory(state.inventory);
      const result = ledger.transact(id, [], [{container: 'bag', batch: item, quantity: 1}]);
      if (!result.ok) return {ok: false, duplicate: false};
      state.inventory = ledger.snapshot();
      return result;
    }
    const run = objective(state.objective);
    const result = run.record({runId: session, eventId: id, event: 'unlock', amount: 1});
    if (result !== 'accepted' && result !== 'duplicate') return {ok: false, duplicate: false};
    state.objective = run.snapshot();
    return {ok: true, duplicate: result === 'duplicate'};
  };
  // Replay this deliberately small authored interaction to validate all coupled facts.
  // Bounds precede kit parsing; missing sink state must never become a fresh ledger.
  const parse = (raw: unknown): Envelope => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('invalid envelope');
    for (const key of ['version', 'consumer', 'choices', 'dialogue', 'intents', 'inventory', 'objective'])
      if (!Object.hasOwn(raw, key)) throw Error('missing envelope field');
    const value = raw as Envelope;
    if (
      value.version !== 1 ||
      value.consumer !== consumer ||
      !Array.isArray(value.choices) ||
      value.choices.length > maxIntents + 1 ||
      !Array.isArray(value.intents) ||
      value.intents.length > maxIntents
    )
      throw Error('invalid envelope bounds');
    const expected = initial(),
      dialogue = createDialogue(definition, session);
    for (const option of value.choices) {
      if (option !== 'accept' && option !== 'leave') throw Error('invalid choice');
      const view = dialogue.view(new Set())!;
      if (!view) throw Error('choice after closure');
      const revision = view.revision;
      const result = dialogue.choose({session, revision, node: view.node, option}, new Set());
      if (result.status !== 'applied') throw Error('invalid choice sequence');
      expected.choices.push(option);
      for (const effect of result.effects) {
        if (effect !== consumer || expected.intents.length >= maxIntents) throw Error('intent bound');
        const id = `${session}:${revision}:0`,
          supplied = value.intents[expected.intents.length];
        if (
          !supplied ||
          supplied.id !== id ||
          typeof supplied.delivered !== 'boolean' ||
          typeof supplied.acknowledged !== 'boolean' ||
          (supplied.acknowledged && !supplied.delivered)
        )
          throw Error('invalid intent');
        // Delivery is sequential: a later intent cannot bypass an unacknowledged one.
        if (supplied.delivered && expected.intents.some(intent => !intent.acknowledged))
          throw Error('out-of-order delivery');
        if (supplied.delivered && !sink(expected, id).ok) throw Error('invalid sink receipt');
        expected.intents.push({id, delivered: supplied.delivered, acknowledged: supplied.acknowledged});
      }
    }
    expected.dialogue = dialogue.snapshot();
    for (const key of ['dialogue', 'inventory', 'objective', 'intents'] as const)
      if (JSON.stringify(value[key]) !== JSON.stringify(expected[key])) throw Error(`inconsistent ${key}`);
    return expected;
  };
  const section: SaveSection<Envelope> = {
    id: `lab.continuation-${consumer}`,
    scope: 'player',
    version: 1,
    flush: 'lazy',
    initial,
    parse,
  };
  const owner = (store: SaveStore, signal: AbortSignal) => {
    const player = store.activePlayer(),
      handle = store.section(section).of(player);
    let observed = handle.get();
    let retired = false,
      active: Ticket | undefined,
      busy = false;
    let unsubscribe = () => {};
    const dispose = () => {
      retired = true;
      active = undefined;
      unsubscribe();
      signal.removeEventListener('abort', dispose);
    };
    unsubscribe = store.onPlayerChanged(dispose);
    signal.addEventListener('abort', dispose, {once: true});
    if (signal.aborted) dispose();
    const live = () => {
      if (retired || signal.aborted || store.activePlayer() !== player) return false;
      // SaveStore values are immutable. An unowned replacement/reset/import is a
      // new lifetime even when it reuses the same serialized intent identities.
      if (handle.get() !== observed) dispose();
      return !retired;
    };
    const saved = () => handle.status() === 'saved';
    const guarded = <T>(operation: () => T): T => {
      if (busy) throw Error('reentrant continuation');
      busy = true;
      try {
        return operation();
      } finally {
        busy = false;
      }
    };
    const checkpoint = (): Result => {
      if (!live()) return 'stale';
      if (['quarantined', 'unavailable', 'newer'].includes(handle.status())) return 'blocked';
      store.flush();
      return saved() ? 'saved' : 'save-failed';
    };
    const commit = (draft: Envelope): Result => {
      handle.replace(parse(draft));
      observed = handle.get();
      return checkpoint();
    };
    const current = (ticket: Ticket) =>
      live() &&
      ticket === active &&
      saved() &&
      handle.get().intents.find(intent => !intent.acknowledged)?.id === ticket.id;
    return {
      view: () => createDialogue(definition, session, handle.get().dialogue).view(new Set()),
      snapshot: (): Envelope => structuredClone(handle.get()),
      checkpoint: () => guarded(checkpoint),
      choose(request: {session: string; revision: number; node: string; option: string}): Result {
        return guarded(() => {
          if (!live()) return 'stale';
          if (!saved()) return 'blocked';
          const draft: Envelope = structuredClone(handle.get());
          if (draft.choices.length >= maxIntents + 1) return 'saturated';
          const dialogue = createDialogue(definition, session, draft.dialogue);
          const result = dialogue.choose(request, new Set());
          if (result.status !== 'applied')
            return result.status === 'closed' ? 'closed' : result.status === 'stale' ? 'stale' : 'refused';
          if (draft.intents.length + result.effects.length > maxIntents) return 'saturated';
          draft.choices.push(request.option);
          for (const _effect of result.effects)
            draft.intents.push({id: `${session}:${request.revision}:0`, delivered: false, acknowledged: false});
          draft.dialogue = dialogue.snapshot();
          return commit(draft);
        });
      },
      begin(): Ticket | null {
        return guarded(() => {
          if (!live() || !saved()) return null;
          const intent = handle.get().intents.find(intent => !intent.acknowledged);
          if (!intent) return null;
          return (active ??= Object.freeze({id: intent.id}));
        });
      },
      deliver(ticket: Ticket): {status: Result; duplicate?: boolean} {
        return guarded(() => {
          if (!current(ticket)) return {status: 'stale'};
          const draft = structuredClone(handle.get()),
            result = sink(draft, ticket.id);
          if (!result.ok) return {status: 'refused'};
          draft.intents.find(intent => intent.id === ticket.id)!.delivered = true;
          return {status: commit(draft), duplicate: result.duplicate};
        });
      },
      acknowledge(ticket: Ticket): Result {
        return guarded(() => {
          if (!current(ticket)) return 'stale';
          const draft = structuredClone(handle.get()),
            intent = draft.intents.find(intent => intent.id === ticket.id)!;
          if (!intent.delivered) return 'refused';
          intent.acknowledged = true;
          const result = commit(draft);
          active = undefined;
          return result;
        });
      },
      dispose,
    };
  };
  return {section, owner, parse};
}
