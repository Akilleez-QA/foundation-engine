import { defineKit, type KitDefinition } from '../../author';
export { resourceProductionSystem } from './system';
export function resources(): KitDefinition { return defineKit({ id: 'resources', requires: ['inventory'] }); }
export * from './pure';
