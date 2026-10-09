import {conditionFixture, type ConditionDefinition} from './condition';

// Authored examples only: units, thresholds and contribution policies are creator choices.
export const wearDefinition: ConditionDefinition = {
  id: 'wear',
  slots: ['body'],
  bagCapacity: 2,
  base: {guard: 1},
  equipped: ['coat'],
  items: [
    {
      item: {id: 'coat', definition: 'coat', slots: ['body'], functional: true},
      initial: 3,
      maximum: 3,
      enabledAbove: 0,
      modifiers: [{stat: 'guard', add: 4, multiply: 1}],
    },
    {
      item: {id: 'trim', definition: 'trim', slots: ['body'], functional: false},
      initial: 3,
      maximum: 3,
      enabledAbove: 0,
      modifiers: [{stat: 'guard', add: 100, multiply: 1}],
    },
  ],
};
export const chargeDefinition: ConditionDefinition = {
  id: 'charge',
  slots: ['hand'],
  bagCapacity: 2,
  base: {light: 0},
  equipped: ['lamp'],
  items: [
    {
      item: {id: 'lamp', definition: 'lamp', slots: ['hand'], functional: true},
      initial: 2,
      maximum: 2,
      enabledAbove: 0,
      modifiers: [{stat: 'light', add: 5, multiply: 1}],
    },
  ],
};
export const wearFixture = () => conditionFixture(wearDefinition);
export const chargeFixture = () => conditionFixture(chargeDefinition);
