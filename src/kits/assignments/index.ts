/** Optional headless assignment ownership; no automatic matching, scheduling or effects. */
import {defineKit, type KitDefinition} from '../../author';
export {createAssignments} from './ledger';
export type {
  AssignmentOptions,
  AssignmentHandle,
  AssignmentToken,
  AssignmentRefusal,
  AssignmentAdmission,
  AssignmentClaim,
  AssignmentSnapshot,
  Assignments,
} from './ledger';

export function assignments(): KitDefinition {
  return defineKit({id: 'assignments'});
}
