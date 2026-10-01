import { defineSaveSection } from '@engine';
import { createObjectiveRun, type ObjectiveSnapshot } from '@kits/objectives';
import { createInventoryLedger, type InventorySnapshot } from '@kits/inventory';
import { createCapabilities, createModifiers } from '@kits/capabilities';
import { createEquipment, type EquipmentSnapshot } from '@kits/equipment';
import { createDialogue, type DialogueState } from '@kits/dialogue';

export const objectiveOptions = { runId: 'expedition-v1', requirements: [{ id: 'stations', event: 'station-visited', target: 3 }] };
export const inventoryOptions = { capacities: { collection: 10 } };
export const briefing = { id: 'expedition-briefing-v1', start: 'welcome', nodes: [{ id: 'welcome', text: 'expedition.welcome', options: [
  { id: 'begin', text: 'expedition.begin', to: null, effects: ['begin-survey'] },
  { id: 'assisted', text: 'expedition.assisted', to: null, effects: ['begin-survey', 'guided-pace'] },
] }] };
export const capabilityDefinitions = [{id:'survey-route',requires:[],evidence:['briefing-accepted']},{id:'guided-pace',requires:['survey-route'],evidence:['practice-complete']}];
export type CapabilitySave = ReturnType<ReturnType<typeof createCapabilities>['snapshot']>;
export const equipmentInitial: EquipmentSnapshot = {revision:0,items:[{id:'boots-1',definition:'trail-boots',slots:['feet'],functional:true},{id:'cap-1',definition:'yellow-cap',slots:['head'],functional:false}],equipped:['cap-1']};
export const restoreEquipment = (saved:EquipmentSnapshot) => createEquipment(['feet','head'],2,saved);
export interface ExpeditionSave { objective: ObjectiveSnapshot; inventory: InventorySnapshot; dialogue: DialogueState; capabilities: CapabilitySave; equipment: EquipmentSnapshot }
export function initialSave(): ExpeditionSave {
  return { objective: createObjectiveRun(objectiveOptions).snapshot(), inventory: createInventoryLedger(inventoryOptions).snapshot(), dialogue: createDialogue(briefing, 'expedition-briefing').snapshot(), capabilities:createCapabilities(capabilityDefinitions).snapshot(), equipment:restoreEquipment(equipmentInitial).snapshot() };
}
export function parseSave(raw: unknown): ExpeditionSave {
  const s = raw as ExpeditionSave;
  if (!s || typeof s !== 'object' || !s.objective || !s.inventory || !s.dialogue || !s.capabilities || !s.equipment) throw Error('Invalid expedition save');
  return { objective: createObjectiveRun(objectiveOptions, s.objective).snapshot(), inventory: createInventoryLedger(inventoryOptions, s.inventory).snapshot(), dialogue: createDialogue(briefing, 'expedition-briefing', s.dialogue).snapshot(), capabilities:createCapabilities(capabilityDefinitions,s.capabilities).snapshot(), equipment:restoreEquipment(s.equipment).snapshot() };
}
/** Objective and reward inventory are updated in the same existing save envelope. */
export const expeditionSave = defineSaveSection({ id: 'expedition.session', initial: initialSave(), parse: parseSave });

export function visitStation(saved: ExpeditionSave, station: number): ExpeditionSave {
  if (!Number.isSafeInteger(station) || station < 0 || station > 2) throw Error('Invalid station');
  const objective = createObjectiveRun(objectiveOptions, saved.objective);
  const inventory = createInventoryLedger(inventoryOptions, saved.inventory);
  objective.record({ runId: objectiveOptions.runId, eventId: `station-${station}`, event: 'station-visited', amount: 1 });
  const claim = objective.claimReward('local-envelope');
  if (claim) {
    const result = inventory.transact(claim.claimId, [], [{ container: 'collection', batch: { id: 'survey-badge-v1', material: 'survey-badge', properties: {} }, quantity: 1 }]);
    if (result.ok) objective.acknowledgeReward(claim.attemptId);
  }
  return { ...saved, objective: objective.snapshot(), inventory: inventory.snapshot() };
}

export default expeditionSave;

/** Assistance is an explicit tutorial grant, not earned mastery or a reading-age inference. */
export function prepareSurvey(saved: ExpeditionSave, assisted: boolean): ExpeditionSave {
  const capabilities=createCapabilities(capabilityDefinitions,saved.capabilities), equipment=restoreEquipment(saved.equipment);
  capabilities.record('briefing-accepted');capabilities.grant({capability:'survey-route',reason:'earned',event:'briefing-v1'});
  if(assisted)capabilities.grant({capability:'guided-pace',reason:'tutorial',event:'assistance-selected-v1'});
  equipment.commit('boots-1',equipment.preview('boots-1').revision);
  return {...saved,capabilities:capabilities.snapshot(),equipment:equipment.snapshot()};
}
/** Gear contributes by source ID; cosmetics never enter functional modifiers. */
export function walkingPace(saved: ExpeditionSave): number {
  const modifiers=createModifiers({pace:3});
  for(const item of restoreEquipment(saved.equipment).active())if(item.definition==='trail-boots')modifiers.set(item.id,[{stat:'pace',add:0,multiply:1.1}]);
  if(createCapabilities(capabilityDefinitions,saved.capabilities).has('guided-pace'))modifiers.set('assistance',[{stat:'pace',add:0,multiply:0.65}]);
  return modifiers.values().pace!;
}
