/**
 * kits/contact: layered contact volumes (vertical cylinders, spheres, boxes) with exact overlap tests and
 * deterministic enter/stay/exit pair events, bounded pairs and per-body contacts, intangibility and snapshots.
 * Cost: no draws; O(n log n + candidate pairs) per update.
 */
import {defineKit, type KitDefinition} from '../../author';

export {createContactLayer, CONTACT_LIMITS} from './contact';
export type {
  BodyInput,
  ContactEvent,
  ContactLayer,
  ContactOptions,
  ContactShape,
  ContactSnapshot,
  ContactUpdate,
  ContactVec3,
} from './contact';

/** Pure helpers only: listing the kit records the choice; nothing is installed. */
export function contact(): KitDefinition {
  return defineKit({id: 'contact'});
}
