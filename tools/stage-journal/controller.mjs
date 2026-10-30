import {createStagedObjectives} from '../../src/kits/objectives/index.ts';
import {createActionRuns, createCapabilities} from '../../src/kits/capabilities/index.ts';
import {createInventoryLedger} from '../../src/kits/inventory/index.ts';

export const storageKey = 'stage-journal|device|journal.session';
export const definition = {
  id: 'calibration-v1',
  revision: 1,
  start: 'prepare',
  stages: [
    {
      id: 'prepare',
      requirements: [{id: 'prepared', event: 'accepted-work', target: 1}],
      choices: [{id: 'continue', to: 'confirm'}],
    },
    {
      id: 'confirm',
      requirements: [{id: 'confirmed', event: 'accepted-work', target: 1}],
      choices: [{id: 'finish', to: null}],
    },
  ],
};
const options = {definition, runId: 'journal-run-v1', maxEventsPerStage: 4};
const inventoryOptions = {capacities: {collection: 1}, maxOperations: 8};
const capabilityDefinitions = [{id: 'calibrated', requires: [], evidence: ['accepted-completion']}];
const rewardId = 'journal-run-v1:completion',
  rewardBatch = {id: 'calibration-token', material: 'calibration-token', properties: {}};
const blocker = {id: 'stored-sample', material: 'stored-sample', properties: {}};
function awardedCapabilities() {
  const c = createCapabilities(capabilityDefinitions);
  c.record('accepted-completion');
  c.grant({capability: 'calibrated', reason: 'earned', event: rewardId});
  return c.snapshot();
}
export function initialEnvelope() {
  const inventory = createInventoryLedger(inventoryOptions);
  inventory.transact('initial-sample', [], [{container: 'collection', batch: blocker, quantity: 1}]);
  return {
    version: 1,
    objective: createStagedObjectives(options).snapshot(),
    inventory: inventory.snapshot(),
    capabilities: createCapabilities(capabilityDefinitions).snapshot(),
    receipt: null,
  };
}
export function parseEnvelope(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== 1 || !raw.objective || !raw.inventory || !raw.capabilities)
    throw Error('Invalid journal envelope');
  const objective = createStagedObjectives(options, raw.objective),
    inventory = createInventoryLedger(inventoryOptions, raw.inventory),
    capabilities = createCapabilities(capabilityDefinitions, raw.capabilities);
  const receipt = raw.receipt;
  if (receipt !== null && receipt !== rewardId) throw Error('Invalid completion receipt');
  const savedInventory = inventory.snapshot();
  const allowed = new Map([
    [
      'initial-sample',
      {
        kind: 'exchange',
        id: 'initial-sample',
        consume: [],
        produce: [{container: 'collection', batch: blocker, quantity: 1}],
      },
    ],
    [
      'release-sample',
      {
        kind: 'exchange',
        id: 'release-sample',
        consume: [{container: 'collection', batchId: blocker.id, quantity: 1}],
        produce: [],
      },
    ],
    [
      rewardId,
      {
        kind: 'exchange',
        id: rewardId,
        consume: [],
        produce: [{container: 'collection', batch: rewardBatch, quantity: 1}],
      },
    ],
  ]);
  if (
    savedInventory.operations[0]?.id !== 'initial-sample' ||
    savedInventory.operations.some(op => JSON.stringify(op) !== JSON.stringify(allowed.get(op.id)))
  )
    throw Error('Unknown journal delivery');
  const rewardOperations = savedInventory.operations.filter(op => op.id === rewardId);
  if (
    rewardOperations.length !== (receipt ? 1 : 0) ||
    inventory.quantity('collection', rewardBatch.id) !== (receipt ? 1 : 0) ||
    (receipt && objective.view().status !== 'complete') ||
    JSON.stringify(capabilities.snapshot()) !==
      JSON.stringify(receipt ? awardedCapabilities() : createCapabilities(capabilityDefinitions).snapshot())
  )
    throw Error('Incoherent completion envelope');
  return {
    version: 1,
    objective: objective.snapshot(),
    inventory: savedInventory,
    capabilities: capabilities.snapshot(),
    receipt,
  };
}

/** This is an authored sample controller, not an engine journal or reward service. */
export function createJournalController({saveHandle, hasEnvelope, now = 0, notify = () => {}}) {
  const actions = createActionRuns({now, maxActions: 32});
  let sequence = 0,
    pending = null,
    retired = false,
    terminalState = null,
    message = 'Perform one accepted action in each stage.';
  const envelope = () => parseEnvelope(saveHandle.get());
  const state = () => {
    if (terminalState) return structuredClone(terminalState);
    const value = envelope(),
      view = createStagedObjectives(options, value.objective).view(),
      inventory = createInventoryLedger(inventoryOptions, value.inventory),
      status = saveHandle.status();
    return {
      view,
      pending: pending ? actions.get(pending.id) : null,
      retired,
      message,
      receipt: value.receipt,
      reward: inventory.quantity('collection', rewardBatch.id),
      blocker: inventory.quantity('collection', blocker.id),
      capability: createCapabilities(capabilityDefinitions, value.capabilities).has('calibrated'),
      saveStatus: status,
      persistence: status === 'saved' ? (hasEnvelope() ? 'Saved locally' : 'Not saved yet') : `Unsaved · ${status}`,
    };
  };
  const emit = () => {
    const s = state();
    notify(s);
    return s;
  };
  const publish = value => saveHandle.update(draft => Object.assign(draft, parseEnvelope(value)), {now: true});
  const command =
    fn =>
    (...args) => {
      if (retired) return state();
      try {
        fn(...args);
      } catch (error) {
        message = error.message;
      }
      return emit();
    };
  const commands = {
    start: command(() => {
      if (pending) {
        message = 'An action is already pending.';
        return;
      }
      const run = createStagedObjectives(options, envelope().objective),
        view = run.view();
      if (view.status !== 'active' || view.ready) {
        message = 'Choose the explicit stage transition.';
        return;
      }
      const id = `accepted-${++sequence}`,
        result = actions.admit({id, owner: options.runId, readyAt: actions.now + 0.4, expiresAt: actions.now + 5});
      if (result.kind !== 'admitted') throw Error(`Action ${result.kind}`);
      pending = {id, ticket: run.ticket()};
      message = 'Action pending; progress has not changed.';
    }),
    choose: command(() => {
      const value = envelope(),
        run = createStagedObjectives(options, value.objective),
        ticket = run.ticket();
      const result = run.transition({
        ...ticket,
        id: `choice-${ticket.incarnation}`,
        choice: ticket.stage === 'prepare' ? 'continue' : 'finish',
      });
      if (result !== 'accepted' && result !== 'duplicate') {
        message = `Transition ${result}.`;
        return;
      }
      publish({...value, objective: run.snapshot()});
      message = run.view().status === 'complete' ? 'Complete. Reward still needs delivery.' : 'Next stage accepted.';
    }),
    deliver: command(() => {
      const value = envelope();
      if (value.receipt) {
        message = 'Reward already accepted; no duplicate delivery.';
        return;
      }
      if (createStagedObjectives(options, value.objective).view().status !== 'complete') {
        message = 'Finish the explicit final choice first.';
        return;
      }
      const inventory = createInventoryLedger(inventoryOptions, value.inventory);
      const result = inventory.transact(rewardId, [], [{container: 'collection', batch: rewardBatch, quantity: 1}]);
      if (!result.ok) {
        message = `Reward pending: ${result.reason}. Free the collection slot and retry.`;
        return;
      }
      // No external reward callback: every consequence is captured in this one candidate envelope.
      publish({...value, inventory: inventory.snapshot(), capabilities: awardedCapabilities(), receipt: rewardId});
      message = 'Reward accepted in memory. Storage status below reports durability.';
    }),
    free: command(() => {
      const value = envelope(),
        inventory = createInventoryLedger(inventoryOptions, value.inventory);
      if (!inventory.quantity('collection', blocker.id)) {
        message = 'Collection slot already released.';
        return;
      }
      const result = inventory.transact(
        'release-sample',
        [{container: 'collection', batchId: blocker.id, quantity: 1}],
        [],
      );
      if (!result.ok) throw Error(`Release ${result.reason}`);
      publish({...value, inventory: inventory.snapshot()});
      message = 'Collection slot released.';
    }),
    cancel: command(() => {
      const value = envelope(),
        run = createStagedObjectives(options, value.objective);
      if (!run.cancel()) {
        message = 'Run cannot be cancelled.';
        return;
      }
      actions.cancelOwner(options.runId);
      pending = null;
      publish({...value, objective: run.snapshot()});
      message = 'Run cancelled; pending action retired.';
    }),
    save: command(() => {
      publish(envelope());
      message = 'Save retried. Inspect storage status.';
    }),
  };
  return {
    ...commands,
    state,
    advance(time) {
      if (retired) return;
      actions.advance(time);
      if (!pending) return;
      const action = actions.get(pending.id);
      if (action.state === 'expired' || action.state === 'cancelled') {
        pending = null;
        message = 'Pending action retired without progress.';
        emit();
        return;
      }
      if (action.state !== 'ready') return;
      const value = envelope(),
        run = createStagedObjectives(options, value.objective),
        result = run.record({...pending.ticket, eventId: pending.id, event: 'accepted-work', amount: 1});
      if (result === 'accepted' || result === 'duplicate') {
        try {
          publish({...value, objective: run.snapshot()});
        } catch (error) {
          message = `Publication raised: ${error.message}. Accepted envelope retained; retry pending work.`;
          emit();
          return;
        }
        actions.acknowledge(action.id, action.revision);
        pending = null;
        message = 'Accepted action recorded. Choose the stage transition.';
      } else {
        actions.cancel(action.id, action.revision);
        pending = null;
        message = `Action consequence ${result}.`;
      }
      emit();
    },
    dispose() {
      if (retired) return;
      retired = true;
      actions.cancelOwner(options.runId);
      pending = null;
      terminalState = state();
    },
  };
}
