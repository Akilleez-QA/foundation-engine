/**
 * kits/breadcrumbs: a leader records its path in a bounded ring; followers retrace it exactly, at a crumb lag
 * (tick-delay partners, party lines) or a path distance (spaced trains, escorts), with segment cuts at teleports.
 * Cost: no draws; O(1) record and lag lookup, O(segment) distance lookup.
 */
import {defineKit, type KitDefinition} from '../../author';

export {createBreadcrumbTrail, nextFollowerLag, TRAIL_LIMITS} from './trail';
export type {BreadcrumbTrail, Crumb, CrumbInput, RecordPolicy, TrailOptions, TrailSnapshot} from './trail';
export {createCompanionRecovery} from './recovery';
export type {CompanionRecovery, RecoveryDecision, RecoveryInput, RecoveryOptions, RecoveryVec3} from './recovery';

/** Pure helpers only: listing the kit records the choice; nothing is installed. */
export function breadcrumbs(): KitDefinition {
  return defineKit({id: 'breadcrumbs'});
}
